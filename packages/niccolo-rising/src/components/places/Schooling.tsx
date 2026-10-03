import { COURSE, COURSES } from '../../sim/content';
import type { Perks } from '../../sim/types';
import { UI } from '../../theme';
import { duration, gr } from '../../lib/format';
import { Blurb, Meta, Panel, Row } from '../ui';
import ActButton from './ActButton';
import type { PlaceProps } from '../types';

function perkText(p: Perks): string {
  const out: string[] = [];
  if (p.gymPct) out.push(`+${p.gymPct}% training`);
  if (p.schemePct) out.push(`+${p.schemePct}% scheme success`);
  if (p.travelPct) out.push(`${p.travelPct}% shorter journeys`);
  if (p.carry) out.push(`carry ${p.carry} more`);
  if (p.infirmaryPct) out.push(`${p.infirmaryPct}% shorter Infirmary stays`);
  if (p.steenPct) out.push(`${p.steenPct}% shorter Steen sentences`);
  if (p.payPct) out.push(`+${p.payPct}% pay`);
  for (const [k, v] of Object.entries(p.workGains ?? {})) out.push(`+${v} ${k}`);
  for (const [k, v] of Object.entries(p.battle ?? {})) out.push(`+${v} ${k}`);
  return out.join(', ');
}

export default function Schooling(p: PlaceProps) {
  const { s, now } = p;
  return (
    <>
      {s.course && (
        <Panel title={`Studying: ${COURSE[s.course.id]?.name}`}>
          <Meta colour={UI.verdigris}>{duration(s.course.ends - now)} left. It carries on while you do other things.</Meta>
        </Panel>
      )}
      <Panel title="Courses" aside={<Meta>{s.coursesDone.length}/{COURSES.length} completed</Meta>}>
        <Blurb>One course at a time, in real hours. What a course teaches is yours for good.</Blurb>
        {COURSES.map(c => {
          const done = s.coursesDone.includes(c.id);
          return (
            <Row key={c.id} style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.88rem', color: done ? UI.good : UI.text }}>
                  {c.name}
                  {done ? ' · completed' : ''}
                </div>
                <Blurb>{c.blurb}</Blurb>
                <Meta>
                  {c.hours} hours · {gr(c.cost)} · {perkText(c.perks)}
                  {c.unlocks ? ` · opens: ${c.unlocks}` : ''}
                  {c.requires ? ` · after ${COURSE[c.requires]?.name}` : ''}
                </Meta>
              </div>
              {!done && <ActButton p={p} verb={{ type: 'ENROL', courseId: c.id }}>Enrol</ActButton>}
            </Row>
          );
        })}
      </Panel>
    </>
  );
}
