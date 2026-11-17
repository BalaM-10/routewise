import { useEffect, useLayoutEffect, useState } from 'react';
import { Calibrate } from './ui/Calibrate';
import { PolicyView } from './ui/PolicyView';
import { Shopdesk } from './ui/Shopdesk';
import { Runs } from './ui/Runs';
import { Overview } from './ui/Overview';
import { useLivePolicy } from './livePolicy';
import { Mark } from './ui/Icons';
import { defaultTasks } from '@routewise/core';
import { loadRecordedReport, loadReport, loadRuns, saveReport, saveRuns, upsertRun } from './store';
import type { ReportOrigin, Run } from './store';
import type { Report, Task } from '@routewise/core';

type Tab = 'overview' | 'desk' | 'routes' | 'calibrate' | 'runs';

/** The app reads in the order a visitor meets it: what Routewise does, the example app, its routes, how they were measured. */
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'desk', label: 'Shopdesk' },
  { id: 'routes', label: 'Routes' },
  { id: 'calibrate', label: 'Calibrate' },
  { id: 'runs', label: 'Runs' },
];

/** What a calibration reports back: whether it is still part-way, and which earlier run filled in the rest. */
export interface SaveMeta {
  show: boolean;
  partial: boolean;
  mergedFrom?: string;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [focus, setFocus] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>(defaultTasks);
  const [report, setReport] = useState<Report | null>(loadReport);
  const [origin, setOrigin] = useState<ReportOrigin>('this browser');
  const [runs, setRuns] = useState<Run[]>(loadRuns);
  const [recorded, setRecorded] = useState<Run | null>(null);
  const live = useLivePolicy();

  useEffect(() => {
    loadRecordedReport().then((r) => {
      if (!r) return;
      setRecorded({ id: r.createdAt, report: r, origin: 'recorded', partial: false });
      if (!report) {
        setReport(r);
        setOrigin('recorded');
      }
    });
  }, []);

  // The shipped run is listed unless this browser already holds the same run.
  const allRuns = recorded && !runs.some((r) => r.id === recorded.id) ? [...runs, recorded].sort((a, b) => b.id.localeCompare(a.id)) : runs;

  // Each page opens at its top; a "Why?" link then scrolls the Routes page to its row.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  const accept = (r: Report, from: ReportOrigin, meta: SaveMeta = { show: true, partial: false }) => {
    setReport(r);
    setOrigin(from);
    if (from !== 'recorded') {
      saveReport(r);
      setRuns((all) => upsertRun(all, { id: r.createdAt, report: r, origin: from, partial: meta.partial, mergedFrom: meta.mergedFrom }));
    }
    if (!meta.show) return;
    setFocus(null);
    setTab('routes');
  };

  const openRun = (run: Run, taskId?: string) => {
    setReport(run.report);
    setOrigin(run.origin);
    if (run.origin !== 'recorded') saveReport(run.report);
    setFocus(taskId ?? null);
    setTab('routes');
  };

  const removeRun = (id: string) => setRuns((all) => saveRuns(all.filter((r) => r.id !== id)));

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => setTab('overview')} aria-label="Routewise overview"><Mark /> <span className="brand-name">Routewise</span></button>
          <nav className="steps" aria-label="Sections">
            {TABS.map((t) => (
              <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      {/* All pages stay mounted, so a drafted reply, the sorted inbox or a running calibration
          survive moving between pages. */}
      <div hidden={tab !== 'overview'}>
        <Overview live={live.policy} runs={allRuns} go={setTab} />
      </div>
      <div hidden={tab !== 'desk'}>
        <Shopdesk report={report} tasks={tasks} remote={live.policy} routesNote={live.note} onWhy={(taskId) => { setFocus(taskId); setTab('routes'); }} />
      </div>
      <div hidden={tab !== 'routes'}>
        <PolicyView
          report={report}
          origin={origin}
          liveId={live.policy?.createdAt ?? null}
          goRuns={() => setTab('runs')}
          focus={tab === 'routes' ? focus : null}
          onImport={(r) => accept(r, 'imported')}
          goCalibrate={() => setTab('calibrate')}
        />
      </div>
      <div hidden={tab !== 'calibrate'}>
        <Calibrate tasks={tasks} setTasks={setTasks} base={origin === 'recorded' ? null : report} onReport={(r, meta) => accept(r, 'this browser', meta)} />
      </div>
      <div hidden={tab !== 'runs'}>
        <Runs runs={allRuns} current={report?.createdAt ?? null} liveId={live.policy?.createdAt ?? null} onOpen={openRun} onRemove={removeRun} />
      </div>
      <footer className="site">Routewise is open source under the Apache 2.0 licence. The sample tickets are fictional; tickets you add are not stored.</footer>
    </>
  );
}
