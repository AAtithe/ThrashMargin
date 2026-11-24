/** War for the Planet: the Journal screen, newest first (fireline-planet-design.md, section 17). W4. */
import type { PlanetProps } from './common';

export default function JournalTab({ s }: PlanetProps) {
  const list = [...s.journal].reverse();
  return (
    <section className="fl-pl-card" data-testid="planet-journal">
      <h3>Journal</h3>
      <span className="fl-small">The last {s.journal.length} entries of the war.</span>
      <ul className="fl-pl-list fl-pl-journal" id="pl-journal">
        {list.map((e, i) => (
          <li key={`${e.turn}-${i}`} className="fl-pl-item" data-tone={e.tone}>
            <span>
              <span className="fl-small">Turn {e.turn} · </span>
              {e.text}
              {/* round7:review begin. A fought battle's turning points, from its after-action review. */}
              {e.review && (
                <details className="fl-pl-review" data-testid="journal-review">
                  <summary>Turning points</summary>
                  <ul>
                    {e.review.map((line, j) => (
                      <li key={j}>{line}</li>
                    ))}
                  </ul>
                </details>
              )}
              {/* round7:review end. */}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
