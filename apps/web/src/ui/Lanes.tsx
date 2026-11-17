/**
 * Two lanes, this computer above and the cloud below, with one station per AI step placed on the
 * lane where it ran (or, before it runs, where its route sends it). Used for the live trace of a
 * ticket in Shopdesk and for the route map on the Routes page, so both read the same way.
 */
export type Lane = 'device' | 'cloud';

export interface Station {
  id: string;
  label: string;
  /** Second line under the label, e.g. "On this computer, 812 ms" or "46 of 48". */
  detail?: string;
  lane: Lane;
  /** done: ran there. active: running now. planned: where its route will send it. kept: stopped on the device by the owner. */
  state: 'done' | 'active' | 'planned' | 'kept';
  /** A lane the route may fall back to, drawn faintly. */
  alt?: Lane;
}

const Y: Record<Lane, number> = { device: 30, cloud: 78 };

export function Lanes(props: {
  stations: Station[];
  /** Words on the line where the trace crosses from this computer to the cloud. */
  crossing?: string;
  onPick?: (id: string) => void;
  label: string;
}) {
  const { stations, crossing, onPick, label } = props;
  const n = stations.length;
  // Stations sit between 14% and 96% of the width, leaving room for the lane names on the left.
  const x = (i: number) => (n === 1 ? 55 : 16 + (i * 78) / (n - 1));
  const crossAt = stations.findIndex((s, i) => i > 0 && s.lane === 'cloud' && stations[i - 1].lane === 'device');

  return (
    <div className="lanes" role="group" aria-label={label}>
      <svg className="lanes-svg" viewBox="0 0 100 108" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="100" y1={Y.device} y2={Y.device} className="lane-rail device" />
        <line x1="0" x2="100" y1={Y.cloud} y2={Y.cloud} className="lane-rail cloud" />
        {stations.slice(1).map((s, i) => {
          const a = stations[i];
          const x1 = x(i), x2 = x(i + 1), y1 = Y[a.lane], y2 = Y[s.lane];
          const mid = (x1 + x2) / 2;
          const d = y1 === y2 ? `M${x1} ${y1}H${x2}` : `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
          const live = s.state === 'done' || s.state === 'active' || s.state === 'kept';
          return <path key={s.id} d={d} className={`lane-path ${live ? s.lane : 'planned'}`} />;
        })}
      </svg>
      <span className="lane-name device">This computer</span>
      <span className="lane-name cloud">Cloud</span>
      {crossAt > 0 && crossing && (
        <span className="lane-crossing" style={{ left: `${(x(crossAt - 1) + x(crossAt)) / 2}%` }}>{crossing}</span>
      )}
      {stations.map((s, i) =>
        s.alt ? <span key={`${s.id}-alt`} className={`dot alt ${s.alt}`} style={{ left: `${x(i)}%`, top: `${(Y[s.alt] / 108) * 100}%` }} title={`Fallback: ${s.alt === 'device' ? 'this computer' : 'the cloud'}`} /> : null,
      )}
      {/* Narrow screens: the same stations listed top to bottom, each in its lane's column. */}
      <ol className="lanes-list">
        <li className="lanes-list-head" aria-hidden="true"><span className="device">This computer</span><span className="cloud">Cloud</span></li>
        {stations.map((s, i) => (
          <li key={s.id} className={`${s.lane} ${s.state}`}>
            {i === crossAt && crossing && <span className="lanes-list-crossing">{crossing}</span>}
            {onPick ? (
              <button className="lanes-list-item" onClick={() => onPick(s.id)}>
                <span className={`dot ${s.lane} ${s.state}`} />
                <span className="station-text"><span className="station-label">{s.label}</span>{s.detail && <span className="station-detail">{s.detail}</span>}</span>
              </button>
            ) : (
              <span className="lanes-list-item">
                <span className={`dot ${s.lane} ${s.state}`} />
                <span className="station-text"><span className="station-label">{s.label}</span>{s.detail && <span className="station-detail">{s.detail}</span>}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
      {stations.map((s, i) => {
        const body = (
          <>
            <span className={`dot ${s.lane} ${s.state}`} />
            <span className="station-text">
              <span className="station-label">{s.label}</span>
              {s.detail && <span className="station-detail">{s.detail}</span>}
            </span>
          </>
        );
        const style = { left: `${x(i)}%`, top: `${(Y[s.lane] / 108) * 100}%` };
        const cls = `station ${s.lane} ${s.state}${s.lane === 'cloud' ? ' below' : ''}`;
        return onPick ? (
          <button key={s.id} className={cls} style={style} onClick={() => onPick(s.id)} aria-label={`${s.label}${s.detail ? `, ${s.detail}` : ''}. Show why`}>
            {body}
          </button>
        ) : (
          <span key={s.id} className={cls} style={style}>{body}</span>
        );
      })}
    </div>
  );
}
