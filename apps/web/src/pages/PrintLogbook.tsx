import { buildRotationPrint, ddmmyyyy, todayISO, type CodeTable, type CommunityPrint, type PrintRow, type RotationPrint, type VerificationLine } from '@logbook/core';
import { Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader, ToneNote } from '../components/ui';
import { rotationName } from '../lib/format';
import { analyticsDate, useInternship } from '../state/AppData';

/**
 * KMPDC paper logbook pages, pre-filled from verified entries for the
 * supervisor's wet signature and stamp. The sheet is styled as paper (black
 * on white) on screen too, so what you see is what prints.
 */
export function PrintLogbookPage() {
  const { ix, ds, state, today } = useInternship();
  const [params, setParams] = useSearchParams();
  const asOf = analyticsDate(today, ix);
  const defaultRotation = ds.rotations.filter((r) => r.startsOn <= asOf).at(-1)?.id ?? ds.rotations[0]!.id;
  const rotationId = params.get('rotation') ?? defaultRotation;
  const [includePending, setIncludePending] = useState(false);
  const [fillToBookRows, setFill] = useState(true);
  const printedOn = todayISO();
  const centre = state.facility?.name ?? ds.internship.institution ?? '';
  const model = useMemo(
    () => buildRotationPrint(ix, rotationId, { includePending, fillToBookRows, printedOn }, centre),
    [ix, rotationId, includePending, fillToBookRows, printedOn, centre],
  );
  const pendingCount = ix.entries.filter((e) => e.status === 'submitted' && e.rotationId === rotationId).length;

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="Print logbook pages"
          actions={
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>
              <Printer size={16} aria-hidden="true" /> Print / save as PDF
            </button>
          }
        >
          The KMPDC case and procedure log, filled from your verified entries, ready for your supervisor's signature and stamp.
        </PageHeader>
        <div className="card mb-4 flex flex-wrap items-end gap-4 p-4">
          <div>
            <label className="label" htmlFor="prot">Rotation</label>
            <select id="prot" className="field !w-auto" value={rotationId} onChange={(e) => setParams({ rotation: e.target.value }, { replace: true })}>
              {ds.rotations.map((r) => (
                <option key={r.id} value={r.id}>
                  {rotationName(ix, r.rotation)}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={fillToBookRows} onChange={(e) => setFill(e.target.checked)} />
            Show all rows of the paper book
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={includePending} onChange={(e) => setIncludePending(e.target.checked)} />
            Include entries awaiting verification{pendingCount ? ` (${pendingCount})` : ''}
          </label>
        </div>
        {pendingCount > 0 && !includePending && (
          <div className="mb-4">
            <ToneNote tone="neutral">
              {pendingCount} entr{pendingCount === 1 ? 'y' : 'ies'} in this rotation {pendingCount === 1 ? 'is' : 'are'} not yet verified and {pendingCount === 1 ? 'is' : 'are'} left off. Get them signed first, or include them to have
              your supervisor sign the paper directly.
            </ToneNote>
          </div>
        )}
      </div>

      <div className="paper-sheet">{model.kind === 'clinical' ? <ClinicalLog p={model} /> : <CommunityLog p={model} />}</div>
    </div>
  );
}

function IdentityBlock({ p, sectionNo }: { p: RotationPrint | CommunityPrint; sectionNo: string }) {
  const Line = ({ label, value }: { label: string; value?: string }) => (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 flex-1 border-b border-dotted border-black pb-0.5 font-medium">{value || ' '}</span>
    </div>
  );
  return (
    <section className="mb-5">
      <h2 className="paper-h2">{sectionNo}.1. Intern&rsquo;s details</h2>
      <div className="space-y-2 text-[10.5pt]">
        <Line label="Full name of Intern" value={p.identity.internName} />
        <div className="grid grid-cols-2 gap-4">
          <Line label="National ID/ Passport no." />
          <Line label="Internship licence no." value={p.identity.licenceNo} />
        </div>
        <Line label="Internship training centre" value={p.identity.trainingCentre} />
        <div className="grid grid-cols-2 gap-4">
          <Line label="Rotation period from" value={ddmmyyyy(p.identity.periodFrom)} />
          <Line label="to" value={ddmmyyyy(p.identity.periodTo)} />
        </div>
      </div>
    </section>
  );
}

function ProcedureRows({ rows }: { rows: PrintRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.serial}>
          <td className="text-center">{r.serial}.</td>
          <td className="text-center tabular-nums">{r.date}</td>
          <td className="text-center">{r.patientRef}</td>
          <td className="text-center">{r.level ? `Level ${r.level}` : ''}</td>
          <td className="paper-sign">{r.supervisor && <span className="paper-faint">{r.supervisor}</span>}</td>
          <td className="paper-ref">{r.pending ? 'awaiting' : r.verificationRef}</td>
        </tr>
      ))}
    </>
  );
}

function CodeTableView({ t }: { t: CodeTable }) {
  const q = t.requirement;
  const head = (
    <thead>
      <tr>
        <th colSpan={6} className="paper-caption">
          {q.code.replace(' ', '')}: {q.description} (Min. req. {q.minCount}, Level {q.expectedLevel})
        </th>
      </tr>
      <tr>
        <th className="w-[8%]">S/No.</th>
        <th className="w-[17%]">
          DATE
          <br />
          <span className="font-normal">DD/MM/YYYY</span>
        </th>
        <th className="w-[19%]">PATIENT NO.</th>
        <th className="w-[15%]">COMPETENCY LEVEL</th>
        <th>SUPERVISOR SIGNATURE</th>
        <th className="w-[11%]">Digital ref.</th>
      </tr>
    </thead>
  );
  return (
    <>
      {t.rows.length > 0 && (
        <table className="paper-table">
          {head}
          <tbody>
            <ProcedureRows rows={t.rows} />
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} className="paper-foot">
                {t.filled} entr{t.filled === 1 ? 'y' : 'ies'} · integrity {t.integrity}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
      {t.continuation.length > 0 && (
        <table className="paper-table">
          <thead>
            <tr>
              <th colSpan={6} className="paper-caption">
                Continuation sheet — {q.code.replace(' ', '')}: {q.description} (Min. req. {q.minCount}, Level {q.expectedLevel})
                {q.printedRows === 0 && <span className="font-normal"> · no rows are printed in the logbook for this code</span>}
              </th>
            </tr>
            <tr>
              <th className="w-[8%]">S/No.</th>
              <th className="w-[17%]">DATE</th>
              <th className="w-[19%]">PATIENT NO.</th>
              <th className="w-[15%]">COMPETENCY LEVEL</th>
              <th>SUPERVISOR SIGNATURE</th>
              <th className="w-[11%]">Digital ref.</th>
            </tr>
          </thead>
          <tbody>
            <ProcedureRows rows={t.continuation} />
          </tbody>
        </table>
      )}
    </>
  );
}

function VerificationAppendix({ lines, integrity }: { lines: VerificationLine[]; integrity: string }) {
  return (
    <section className="paper-break">
      <h2 className="paper-h2">Digital verification record</h2>
      <p className="mb-2 text-[9pt]">
        Each logbook row above carries the reference of its supervisor verification. Verifications are append-only and hash-chained; any later change to a verified
        entry is detectable. Document integrity code: <strong>{integrity}</strong>.
      </p>
      {lines.length === 0 ? (
        <p className="text-[9pt]">No digital verifications for this rotation.</p>
      ) : (
        <table className="paper-table paper-small">
          <thead>
            <tr>
              <th>Ref.</th>
              <th>Code</th>
              <th>Date</th>
              <th>Decision</th>
              <th>Signed by</th>
              <th>Method</th>
              <th>Signed at</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.ref + l.signedAt}>
                <td className="font-mono">{l.ref}</td>
                <td>{l.code}</td>
                <td>{l.performedOn}</td>
                <td>{l.decision}</td>
                <td>{l.verifier}</td>
                <td>{l.method === 'pin' ? 'PIN on intern’s phone' : l.method}</td>
                <td>{l.signedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SheetFooter({ integrity }: { integrity: string }) {
  return (
    <p className="mt-6 text-[8.5pt]">
      Generated from the intern&rsquo;s digital logbook on {ddmmyyyy(todayISO())}. Supervisor signatures and stamps are required on this printed copy until KMPDC accepts digital
      sign-off. Integrity code {integrity}.
    </p>
  );
}

function ClinicalLog({ p }: { p: RotationPrint }) {
  const n = p.section;
  return (
    <article>
      <h1 className="paper-h1">
        {n}. {p.rotationName.toUpperCase()} ROTATION
      </h1>
      <IdentityBlock p={p} sectionNo={n} />
      <h2 className="paper-h2">{n}.4. Case and Procedure Log</h2>
      {p.tables.map((t) => (
        <CodeTableView key={t.requirement.code} t={t} />
      ))}
      <h2 className="paper-h2 paper-break">{n}.5. Log of Case Reports</h2>
      <table className="paper-table">
        <thead>
          <tr>
            <th className="w-[10%]">CASE NO.</th>
            <th>CASE DESCRIPTION</th>
            <th className="w-[17%]">DATE</th>
            <th className="w-[22%]">SUPERVISOR SIGNATURE</th>
            <th className="w-[11%]">Digital ref.</th>
          </tr>
        </thead>
        <tbody>
          {p.caseReports.map((r) => (
            <tr key={r.serial}>
              <td className="text-center">{r.serial}.</td>
              <td className="text-[9pt]">{r.title}</td>
              <td className="text-center tabular-nums">{r.date}</td>
              <td className="paper-sign">{r.supervisor && <span className="paper-faint">{r.supervisor}</span>}</td>
              <td className="paper-ref">{r.pending ? 'awaiting' : r.verificationRef}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <VerificationAppendix lines={p.verificationLog} integrity={p.integrity} />
      <SheetFooter integrity={p.integrity} />
    </article>
  );
}

function CommunityLog({ p }: { p: CommunityPrint }) {
  const n = p.section;
  const cell = (r: { date: string; verificationRef: string; pending: boolean; supervisor: string }) => (
    <>
      <td className="text-center tabular-nums">{r.date}</td>
      <td className="paper-sign">{r.supervisor && <span className="paper-faint">{r.supervisor}</span>}</td>
      <td className="paper-ref">{r.pending ? 'awaiting' : r.verificationRef}</td>
    </>
  );
  return (
    <article>
      <h1 className="paper-h1">
        {n}. {p.rotationName.toUpperCase()} ROTATION
      </h1>
      <IdentityBlock p={p} sectionNo={n} />
      <h2 className="paper-h2">{n}.4. Log of Community Dentistry activities</h2>
      <table className="paper-table">
        <thead>
          <tr>
            <th className="w-[7%]">S/NO.</th>
            <th>ACTIVITY</th>
            <th className="w-[16%]">
              DATE
              <br />
              <span className="font-normal">DD/MM/YYYY</span>
            </th>
            <th className="w-[20%]">SUPERVISOR SIGNATURE</th>
            <th className="w-[11%]">Digital ref.</th>
          </tr>
        </thead>
        <tbody>
          {p.activities.map((a, i) => (
            <tr key={i}>
              <td className="text-center">{i + 1}.</td>
              <td>{a.label}</td>
              {cell(a)}
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="paper-h2 paper-break">{n}.5. Case follow-up for oral manifestations in systemic illness</h2>
      <table className="paper-table">
        <thead>
          <tr>
            <th className="w-[16%]">CASE TYPE</th>
            <th>ACTIVITY</th>
            <th className="w-[9%]">CASE NO.</th>
            <th className="w-[15%]">DATE</th>
            <th className="w-[18%]">SUPERVISOR SIGNATURE</th>
            <th className="w-[10%]">Digital ref.</th>
          </tr>
        </thead>
        {p.caseFollowUp.map((c) => (
          <tbody key={c.caseType} className="paper-group">
            {c.steps.flatMap((s, si) =>
              s.rows.map((r, ri) => (
                <tr key={`${s.step}-${ri}`}>
                  {si === 0 && ri === 0 && (
                    <td rowSpan={c.steps.reduce((n2, x) => n2 + x.rows.length, 0)} className="align-top font-medium">
                      {c.caseName} case follow-up
                    </td>
                  )}
                  {ri === 0 && (
                    <td rowSpan={s.rows.length} className="align-top">
                      {s.step}. {s.stepName}
                    </td>
                  )}
                  <td className="text-center">Case {r.caseNo}</td>
                  {cell(r)}
                </tr>
              )),
            )}
          </tbody>
        ))}
      </table>

      <h2 className="paper-h2 paper-break">{n}.6. Log of Weekly Reports on Community Dentistry activities</h2>
      <table className="paper-table">
        <thead>
          <tr>
            <th className="w-[9%]">CASE NO.</th>
            <th>ACTIVITY REPORTED</th>
            <th className="w-[16%]">DATE</th>
            <th className="w-[20%]">SUPERVISOR SIGNATURE</th>
            <th className="w-[11%]">Digital ref.</th>
          </tr>
        </thead>
        <tbody>
          {p.weeklyReports.map((w, i) => (
            <tr key={i}>
              <td className="text-center">{i + 1}.</td>
              <td>{w.label}</td>
              {cell(w)}
            </tr>
          ))}
        </tbody>
      </table>
      <VerificationAppendix lines={p.verificationLog} integrity={p.integrity} />
      <SheetFooter integrity={p.integrity} />
    </article>
  );
}
