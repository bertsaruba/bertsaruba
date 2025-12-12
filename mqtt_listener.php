<?php
// Simple MQTT subscriber that writes EPC and timestamp values into SQLite.
// Configure broker connection.
$brokerHost = 'timing.events';
$brokerPort = 1883;
$username   = 'timing';
$password   = 'RFID#Data08';
$topic      = 'finish';
$keepAlive  = 60; // seconds

$dbPath = __DIR__ . '/database.sqlite';

try {
    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            TAGNAME TEXT NOT NULL,
            TIMESTAMP TEXT NOT NULL,
            RAW_JSON TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (DATETIME("now"))
        )'
    );
} catch (PDOException $e) {
    fwrite(STDERR, "Database error: {$e->getMessage()}\n");
    exit(1);
}

/**
 * Open an MQTT connection and subscribe to the configured topic.
 *
 * @return resource|null
 */
function openMqttSocket(string $host, int $port, string $username, string $password, string $topic, int $keepAlive)
{
    $clientId = 'php-listener-' . bin2hex(random_bytes(4));
    $socket = @fsockopen($host, $port, $errno, $errstr, 10);
    if (!$socket) {
        fwrite(STDERR, "Unable to connect to MQTT broker: $errstr ($errno)\n");
        return null;
    }

    stream_set_timeout($socket, 5);

    // CONNECT packet
    $connectFlags = 0x02; // clean session
    if ($username !== '') {
        $connectFlags |= 0x80; // username flag
    }
    if ($password !== '') {
        $connectFlags |= 0x40; // password flag
    }

    $payload  = packString('MQTT');
    $payload .= chr(0x04);            // protocol level 4 (MQTT 3.1.1)
    $payload .= chr($connectFlags);
    $payload .= pack('n', $keepAlive);
    $payload .= packString($clientId);
    if ($username !== '') {
        $payload .= packString($username);
    }
    if ($password !== '') {
        $payload .= packString($password);
    }

    $packet = chr(0x10) . encodeLength(strlen($payload)) . $payload;
    fwrite($socket, $packet);

    // Read CONNACK
    $response = readPacket($socket);
    if ($response === null || ($response['type'] !== 0x20) || (isset($response['payload'][1]) && ord($response['payload'][1]) !== 0)) {
        fwrite(STDERR, "MQTT broker rejected connection\n");
        fclose($socket);
        return null;
    }

    // SUBSCRIBE packet
    $packetId = random_int(1, 0xFFFF);
    $subPayload  = pack('n', $packetId);
    $subPayload .= packString($topic) . chr(0x00); // QoS 0
    $subscribePacket = chr(0x82) . encodeLength(strlen($subPayload)) . $subPayload;
    fwrite($socket, $subscribePacket);

    // Consume SUBACK
    $subAck = readPacket($socket);
    if ($subAck === null || $subAck['type'] !== 0x90) {
        fwrite(STDERR, "Failed to subscribe to topic {$topic}\n");
        fclose($socket);
        return null;
    }

    fwrite(STDOUT, "Connected to MQTT broker {$host}:{$port} and subscribed to '{$topic}'.\n");
    return $socket;
}

/**
 * Persist a reading into the SQLite database.
 */
function saveReading(PDO $pdo, string $tagName, string $timestamp, string $rawJson): void
{
    $stmt = $pdo->prepare('INSERT INTO readings (TAGNAME, TIMESTAMP, RAW_JSON) VALUES (:tag, :time, :raw)');
    $stmt->execute([
        ':tag'  => $tagName,
        ':time' => $timestamp,
        ':raw'  => $rawJson,
    ]);
}

function packString(string $value): string
{
    return pack('n', strlen($value)) . $value;
}

function encodeLength(int $length): string
{
    $encoded = '';
    do {
        $digit = $length % 128;
        $length = intdiv($length, 128);
        if ($length > 0) {
            $digit |= 0x80;
        }
        $encoded .= chr($digit);
    } while ($length > 0);

    return $encoded;
}

function decodeLength($socket): ?int
{
    $multiplier = 1;
    $value = 0;
    do {
        $byte = fgetc($socket);
        if ($byte === false) {
            return null;
        }
        $digit = ord($byte);
        $value += ($digit & 0x7F) * $multiplier;
        $multiplier *= 128;
    } while (($digit & 0x80) !== 0 && $multiplier <= 128 * 128 * 128);

    return $value;
}

function readPacket($socket): ?array
{
    $firstByte = fgetc($socket);
    if ($firstByte === false) {
        return null;
    }

    $length = decodeLength($socket);
    if ($length === null) {
        return null;
    }

    $payload = '';
    while (strlen($payload) < $length) {
        $chunk = fread($socket, $length - strlen($payload));
        if ($chunk === false || $chunk === '') {
            return null;
        }
        $payload .= $chunk;
    }

    return [
        'type'    => ord($firstByte) & 0xF0,
        'flags'   => ord($firstByte) & 0x0F,
        'payload' => $payload,
    ];
}

function sendPing($socket): void
{
    fwrite($socket, chr(0xC0) . chr(0x00));
}

function extractField(array $data, array $keys): ?string
{
    foreach ($keys as $key) {
        if (isset($data[$key]) && $data[$key] !== '') {
            return (string) $data[$key];
        }
    }

    return null;
}

$socket = openMqttSocket($brokerHost, $brokerPort, $username, $password, $topic, $keepAlive);
if ($socket === null) {
    exit(1);
}

$lastActivity = time();

while (true) {
    $read = [$socket];
    $write = $except = null;
    $timeout = max(1, $keepAlive - (time() - $lastActivity));
    $changed = stream_select($read, $write, $except, $timeout);

    if ($changed === false) {
        fwrite(STDERR, "stream_select failed, reconnecting...\n");
        break;
    }

    if ($changed === 0) {
        // No data available; send PINGREQ to keep the connection alive.
        sendPing($socket);
        $lastActivity = time();
        continue;
    }

    $packet = readPacket($socket);
    if ($packet === null) {
        fwrite(STDERR, "Connection lost, exiting.\n");
        break;
    }

    $lastActivity = time();

    if ($packet['type'] === 0xD0) {
        // PINGRESP - nothing to do.
        continue;
    }

    if ($packet['type'] !== 0x30) {
        // Only handle QoS 0 PUBLISH packets.
        continue;
    }

    $payload = $packet['payload'];
    $topicLength = unpack('n', substr($payload, 0, 2))[1];
    $messageTopic = substr($payload, 2, $topicLength);
    $message = substr($payload, 2 + $topicLength);

    $decoded = json_decode($message, true);
    if (!is_array($decoded)) {
        fwrite(STDERR, "Received non-JSON payload on {$messageTopic}\n");
        continue;
    }

    $tagName = extractField($decoded, ['epc', 'EPC', 'tag', 'tagname', 'TAGNAME']);
    $timestamp = extractField($decoded, ['timestamp', 'Timestamp', 'TIMESTAMP', 'time', 'Time']);

    if ($tagName === null || $timestamp === null) {
        fwrite(STDERR, "Missing EPC or timestamp in payload: {$message}\n");
        continue;
    }

    try {
        saveReading($pdo, $tagName, $timestamp, $message);
        fwrite(STDOUT, "Stored read: EPC={$tagName}, timestamp={$timestamp}\n");
    } catch (Throwable $e) {
        fwrite(STDERR, "Failed to save reading: {$e->getMessage()}\n");
    }
}

fclose($socket);
