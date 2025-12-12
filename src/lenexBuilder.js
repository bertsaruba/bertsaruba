const { DateTime } = require('./utils');
const { tryRenderWithJsLenex } = require('./lenexWriter');

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeTimingEventsData(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Expected a timing.events JSON payload to normalize.');
  }

  const event = raw.event ?? raw.meet ?? raw;
  const meetId = event.id ?? event.code ?? 'timing-events-meet';
  const meetName = event.name ?? 'Timing.Events Meet';
  const city = event.city ?? event.location?.city ?? 'Unknown';
  const nation = event.nation ?? event.country ?? event.location?.country ?? 'UNK';
  const startDate = DateTime.asDate(event.startDate ?? event.date ?? event.start ?? new Date());
  const endDate = DateTime.asDate(event.endDate ?? event.finishDate ?? event.end ?? startDate);

  const clubs = buildClubs(raw.clubs, raw.teams, raw.clubList, raw.results);
  const athletes = buildAthletes(raw.athletes, raw.participants, raw.results, clubs);
  const sessions = buildSessions(raw.sessions ?? raw.events, raw.results, athletes, clubs, startDate);

  return {
    id: meetId,
    name: meetName,
    city,
    nation,
    startDate,
    endDate,
    clubs,
    athletes,
    sessions,
  };
}

function buildClubs(primary, teams, clubList, results) {
  const clubs = new Map();
  const sources = [primary, teams, clubList];
  sources.forEach(list => {
    if (!Array.isArray(list)) return;
    list.forEach((club, index) => {
      const id = club.id ?? club.code ?? `club-${index + 1}`;
      clubs.set(id, {
        id,
        name: club.name ?? club.title ?? club.longName ?? id,
        shortName: club.shortName ?? club.code ?? id,
        nation: club.nation ?? club.country ?? 'UNK',
      });
    });
  });

  if (Array.isArray(results)) {
    results.forEach(result => {
      if (!result.club) return;
      const id = result.club.id ?? result.club.code ?? result.club;
      if (!clubs.has(id)) {
        clubs.set(id, {
          id,
          name: result.club.name ?? result.club,
          shortName: result.club.code ?? id,
          nation: result.club.nation ?? result.club.country ?? 'UNK',
        });
      }
    });
  }

  return Array.from(clubs.values());
}

function buildAthletes(primary, participants, results, clubs) {
  const athletes = new Map();
  const clubIds = new Set(clubs.map(c => c.id));
  const sources = [primary, participants];

  sources.forEach(list => {
    if (!Array.isArray(list)) return;
    list.forEach((athlete, index) => {
      const id = athlete.id ?? athlete.code ?? `athlete-${index + 1}`;
      const clubId = athlete.clubId ?? athlete.club ?? athlete.teamId;
      athletes.set(id, {
        id,
        firstName: athlete.firstName ?? athlete.givenName ?? athlete.name?.first ?? '',
        lastName: athlete.lastName ?? athlete.familyName ?? athlete.name?.last ?? '',
        birthDate: DateTime.asDate(athlete.birthDate ?? athlete.birthday),
        gender: normalizeGender(athlete.gender),
        clubId: clubIds.has(clubId) ? clubId : undefined,
      });
    });
  });

  if (Array.isArray(results)) {
    results.forEach(result => {
      const competitor = result.athlete ?? result.swimmer ?? result.participant;
      if (!competitor) return;
      const id = competitor.id ?? competitor.code ?? `${competitor.lastName ?? 'athlete'}-${athletes.size + 1}`;
      if (athletes.has(id)) return;
      const clubId = competitor.clubId ?? competitor.club ?? result.club?.id;
      athletes.set(id, {
        id,
        firstName: competitor.firstName ?? competitor.givenName ?? competitor.name?.first ?? '',
        lastName: competitor.lastName ?? competitor.familyName ?? competitor.name?.last ?? '',
        birthDate: DateTime.asDate(competitor.birthDate ?? competitor.birthday),
        gender: normalizeGender(competitor.gender ?? result.gender),
        clubId: clubIds.has(clubId) ? clubId : undefined,
      });
    });
  }

  return Array.from(athletes.values());
}

function buildSessions(sourceSessions, results, athletes, clubs, defaultDate) {
  const sessions = [];

  if (Array.isArray(sourceSessions) && sourceSessions.some(Boolean)) {
    sourceSessions.forEach((session, sessionIndex) => {
      const events = normalizeEvents(session.events ?? session.items ?? (Array.isArray(sourceSessions) && !session.events ? [session] : []), results, athletes, clubs);
      sessions.push({
        id: session.id ?? `session-${sessionIndex + 1}`,
        name: session.name ?? session.title ?? `Session ${sessionIndex + 1}`,
        date: DateTime.asDate(session.date ?? defaultDate),
        events,
      });
    });
  } else {
    const events = normalizeEvents(sourceSessions, results, athletes, clubs);
    sessions.push({
      id: 'session-1',
      name: 'Session 1',
      date: defaultDate,
      events,
    });
  }

  return sessions;
}

function normalizeEvents(events, results, athletes, clubs) {
  const normalized = [];
  if (Array.isArray(events)) {
    events.forEach((event, eventIndex) => {
      if (!event) return;
      const eventResults = collectResultsForEvent(event, results);
      normalized.push({
        id: event.id ?? `event-${eventIndex + 1}`,
        number: event.number ?? event.event ?? eventIndex + 1,
        name: event.name ?? event.title ?? `Event ${eventIndex + 1}`,
        gender: normalizeGender(event.gender),
        distance: event.distance ?? event.length,
        stroke: normalizeStroke(event.stroke ?? event.style ?? event.stoke),
        ageGroup: event.ageGroup ?? event.category ?? event.class,
        results: normalizeResults(eventResults, athletes, clubs),
      });
    });
  }

  return normalized;
}

function collectResultsForEvent(event, results) {
  if (!Array.isArray(results)) return event.results ?? [];
  const eventId = event.id ?? event.eventId ?? event.number;
  return results.filter(result => {
    const resultEventId = result.eventId ?? result.event?.id ?? result.event?.number;
    return resultEventId === eventId || result.eventNumber === eventId;
  });
}

function normalizeResults(resultList, athletes, clubs) {
  if (!Array.isArray(resultList)) return [];
  const athleteIndex = new Map(athletes.map(a => [a.id, a]));
  const clubIndex = new Map(clubs.map(c => [c.id, c]));

  return resultList.map((result, resultIndex) => {
    const competitor = result.athlete ?? result.swimmer ?? result.participant ?? {};
    const athleteId = competitor.id ?? competitor.code ?? result.athleteId;
    return {
      rank: result.rank ?? result.place ?? result.position ?? resultIndex + 1,
      heat: result.heat ?? result.run ?? result.wave,
      lane: result.lane,
      athleteId,
      athleteName: `${competitor.firstName ?? competitor.givenName ?? ''} ${competitor.lastName ?? competitor.familyName ?? ''}`.trim(),
      clubId: result.clubId ?? result.club?.id ?? competitor.clubId ?? competitor.club,
      time: normalizeTime(result.time ?? result.result ?? result.swimTime ?? result.finish ?? result.value),
      reactionTime: normalizeTime(result.reaction ?? result.reactionTime),
      points: result.points ?? result.score,
      status: result.status ?? result.note,
      athlete: athleteIndex.get(athleteId),
      club: clubIndex.get(result.clubId ?? result.club?.id ?? competitor.clubId ?? competitor.club),
    };
  });
}

function normalizeGender(gender) {
  if (!gender) return undefined;
  const lower = String(gender).toLowerCase();
  if (['m', 'male', 'men', 'gents'].includes(lower)) return 'M';
  if (['f', 'female', 'women', 'ladies', 'w'].includes(lower)) return 'F';
  return gender.toString().toUpperCase();
}

function normalizeStroke(stroke) {
  if (!stroke) return undefined;
  const lower = String(stroke).toLowerCase();
  if (['free', 'freestyle', 'crawl'].includes(lower)) return 'FREE';
  if (['back', 'backstroke'].includes(lower)) return 'BACK';
  if (['breast', 'breaststroke'].includes(lower)) return 'BREAST';
  if (['fly', 'butterfly'].includes(lower)) return 'FLY';
  if (['im', 'medley', 'individual medley'].includes(lower)) return 'MEDLEY';
  return stroke.toString().toUpperCase();
}

function normalizeTime(time) {
  if (time == null) return undefined;
  if (typeof time === 'number') return time;
  if (typeof time !== 'string') return undefined;

  const trimmed = time.trim();
  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) return numeric;

  const parts = trimmed.split(':').map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  let seconds = 0;
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  } else {
    seconds = parts[0];
  }
  return seconds;
}

async function buildLenexXml(raw, options = {}) {
  const meet = normalizeTimingEventsData(raw);
  const lenexObject = buildLenexObject(meet);
  const jsLenexXml = await tryRenderWithJsLenex(lenexObject, options);
  if (jsLenexXml) return jsLenexXml;
  return renderManually(lenexObject);
}

function buildLenexObject(meet) {
  const clubIndex = new Map(meet.clubs.map((club, index) => [club.id ?? `club-${index + 1}`, club]));
  const athleteIndex = new Map(meet.athletes.map((athlete, index) => [athlete.id ?? `athlete-${index + 1}`, athlete]));

  const sessions = meet.sessions.map(session => ({
    id: session.id,
    name: session.name,
    date: DateTime.asDate(session.date),
    events: session.events.map(event => ({
      id: event.id,
      number: event.number,
      name: event.name,
      gender: event.gender,
      distance: event.distance,
      stroke: event.stroke,
      ageGroup: event.ageGroup,
      results: event.results.map(result => ({
        ...result,
        athlete: athleteIndex.get(result.athleteId) ?? result.athlete,
        club: clubIndex.get(result.clubId) ?? result.club,
      })),
    })),
  }));

  return { ...meet, sessions };
}

function renderManually(lenex) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(`<LENEX version="3.0">`);
  lines.push('  <MEETS>');
  lines.push(`    <MEET id="${escapeXml(lenex.id)}" name="${escapeXml(lenex.name)}" city="${escapeXml(lenex.city)}" nation="${escapeXml(lenex.nation)}">`);
  lines.push('      <CLUBS>');
  lenex.clubs.forEach(club => {
    lines.push(`        <CLUB id="${escapeXml(club.id)}" name="${escapeXml(club.name)}" shortname="${escapeXml(club.shortName ?? club.name)}" nation="${escapeXml(club.nation ?? lenex.nation)}"/>`);
  });
  lines.push('      </CLUBS>');
  lines.push('      <ATHLETES>');
  lenex.athletes.forEach(athlete => {
    const birth = athlete.birthDate ? ` birth="${escapeXml(DateTime.asDate(athlete.birthDate))}"` : '';
    const clubRef = athlete.clubId ? ` clubid="${escapeXml(athlete.clubId)}"` : '';
    const gender = athlete.gender ? ` gender="${escapeXml(athlete.gender)}"` : '';
    lines.push(`        <ATHLETE id="${escapeXml(athlete.id)}"${clubRef}${gender}${birth}>`);
    lines.push(`          <NAME>${escapeXml([athlete.firstName, athlete.lastName].filter(Boolean).join(' '))}</NAME>`);
    lines.push('        </ATHLETE>');
  });
  lines.push('      </ATHLETES>');
  lines.push('      <SESSIONS>');
  lenex.sessions.forEach(session => {
    lines.push(`        <SESSION id="${escapeXml(session.id)}" name="${escapeXml(session.name)}" date="${escapeXml(DateTime.asDate(session.date))}">`);
    lines.push('          <EVENTS>');
    session.events.forEach(event => {
      const distance = event.distance ? ` distance="${escapeXml(event.distance)}"` : '';
      const stroke = event.stroke ? ` stroke="${escapeXml(event.stroke)}"` : '';
      const gender = event.gender ? ` gender="${escapeXml(event.gender)}"` : '';
      const age = event.ageGroup ? ` agegroup="${escapeXml(event.ageGroup)}"` : '';
      lines.push(`            <EVENT id="${escapeXml(event.id)}" number="${escapeXml(event.number)}" name="${escapeXml(event.name)}"${distance}${stroke}${gender}${age}>`);
      lines.push('              <RESULTS>');
      event.results.forEach(result => {
        const athleteId = result.athlete?.id ?? result.athleteId;
        const clubId = result.club?.id ?? result.clubId;
        const lane = result.lane ? ` lane="${escapeXml(result.lane)}"` : '';
        const heat = result.heat ? ` heat="${escapeXml(result.heat)}"` : '';
        const time = result.time != null ? ` time="${escapeXml(result.time)}"` : '';
        const reaction = result.reactionTime != null ? ` reaction="${escapeXml(result.reactionTime)}"` : '';
        const points = result.points != null ? ` points="${escapeXml(result.points)}"` : '';
        const status = result.status ? ` status="${escapeXml(result.status)}"` : '';
        lines.push(`                <RESULT rank="${escapeXml(result.rank ?? '')}" athleteid="${escapeXml(athleteId ?? '')}" clubid="${escapeXml(clubId ?? '')}"${lane}${heat}${time}${reaction}${points}${status}/>`);
      });
      lines.push('              </RESULTS>');
      lines.push('            </EVENT>');
    });
    lines.push('          </EVENTS>');
    lines.push('        </SESSION>');
  });
  lines.push('      </SESSIONS>');
  lines.push('    </MEET>');
  lines.push('  </MEETS>');
  lines.push('</LENEX>');
  return lines.join('\n');
}

module.exports = {
  buildLenexXml,
  normalizeTimingEventsData,
};
