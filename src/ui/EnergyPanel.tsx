// src/ui/EnergyPanel — the per-hand energy table (DESIGN.md §4.5, §6).
//
// Reads core's period-aggregated `energyReport` for the current simulation and
// lays it out as a table: one row per hand plus a totals row, columns throw work
// W⁺, catch absorption |W⁻|, net, average power (full-word headers, the NOTATION
// symbol in a tooltip). The figures are period-aggregated and time-independent
// between rebuilds, so they are recomputed only when the sim changes (useMemo on
// `sim`) — NOT per frame (DESIGN.md §2: the sim is a pure function of time; the
// energy over a period does not depend on where the playhead is).

import { useMemo, type CSSProperties, type ReactElement } from 'react';
import { energyReport } from '../core/energy';
import { useAppStore } from '../state';
import { energyRows, formatEnergy } from './energyPanel';

/** A table header cell with a full-word label and the NOTATION symbol in a tooltip. */
function HeaderCell({
  label,
  symbol,
  align = 'right',
}: {
  readonly label: string;
  readonly symbol: string;
  readonly align?: 'left' | 'right';
}): ReactElement {
  return (
    <th style={{ ...thStyle, textAlign: align }} title={symbol}>
      {label}
      <span style={symbolStyle}> {symbol}</span>
    </th>
  );
}

/** The per-hand energy table with a totals row (DESIGN.md §4.5, §6). */
export function EnergyPanel(): ReactElement {
  const sim = useAppStore((state) => state.sim);
  // Period-aggregated + time-independent: recompute only on a sim rebuild.
  const report = useMemo(() => energyReport(sim.kinematics, sim.timeline), [sim]);
  const { hands, total } = useMemo(() => energyRows(report), [report]);

  const periodEndBeat = report.periodBeats;
  const rowCells = (
    label: string,
    values: readonly number[],
    isTotal: boolean,
  ): ReactElement => (
    <tr style={isTotal ? totalRowStyle : undefined}>
      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: isTotal ? 700 : 400 }}>{label}</td>
      {values.map((value, index) => (
        <td key={index} style={tdStyle}>
          {formatEnergy(value)}
        </td>
      ))}
    </tr>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left' }}>Hand</th>
              <HeaderCell label="Throw work" symbol="W⁺ (J/kg)" />
              <HeaderCell label="Catch absorption" symbol="|W⁻| (J/kg)" />
              <HeaderCell label="Net" symbol="W (J/kg)" />
              <HeaderCell label="Average power" symbol="(W/kg)" />
            </tr>
          </thead>
          <tbody>
            {hands.map((row) =>
              rowCells(
                row.label,
                [row.workPositive, row.workNegativeMagnitude, row.net, row.averagePower],
                false,
              ),
            )}
            {rowCells(
              total.label,
              [
                total.workPositive,
                total.workNegativeMagnitude,
                total.net,
                total.averagePower,
              ],
              true,
            )}
          </tbody>
        </table>
      </div>
      <p style={captionStyle}>
        Per hand over one spatial period (beats 0–{periodEndBeat}; repeats every{' '}
        {report.periodTime.toFixed(3)} s). Net = throw work − catch absorption. Contact force is
        zero at every catch and release, so net = ΔKE + g·Δy over the carry (work–energy theorem).
        Figures reflect the parameters in force at the start of the pattern; a live gravity or
        geometry change applies to future beats and does not move a past period&apos;s numbers.
      </p>
    </div>
  );
}

// --- Inline styling (matches the light shell of the Phase 3–6 UI) ------------

const tableStyle: CSSProperties = {
  borderCollapse: 'collapse',
  fontSize: '0.85rem',
  minWidth: '32rem',
};

const thStyle: CSSProperties = {
  padding: '0.3rem 0.6rem',
  color: '#5b6472',
  fontWeight: 600,
  borderBottom: '1px solid #dfe3ea',
  whiteSpace: 'nowrap',
};

const symbolStyle: CSSProperties = {
  color: '#8a93a2',
  fontWeight: 400,
  fontSize: '0.75rem',
};

const tdStyle: CSSProperties = {
  padding: '0.25rem 0.6rem',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const totalRowStyle: CSSProperties = {
  borderTop: '2px solid #d5dae2',
  background: '#f4f6f9',
};

const captionStyle: CSSProperties = {
  margin: 0,
  color: '#5b6472',
  fontSize: '0.78rem',
  lineHeight: 1.4,
};
