// src/ui/EnergyPanel — the per-hand energy table (DESIGN.md §4.5, §6).
//
// Reads core's period-aggregated `energyReport` for the current simulation and
// lays it out as a table: one row per hand plus a totals row, columns throw work
// W⁺, catch absorption |W⁻|, average power (full-word headers, the NOTATION
// symbol in a tooltip). The figures are period-aggregated and time-independent
// between rebuilds, so they are recomputed only when the sim changes (useMemo on
// `sim`) — NOT per frame (DESIGN.md §2: the sim is a pure function of time; the
// energy over a period does not depend on where the playhead is).

import { useMemo, type CSSProperties, type ReactElement } from 'react';
import { energyReport } from '../core/energy';
import { useAppStore } from '../state';
import { energyRows, formatEnergy } from './energyPanel';
import { usePalette, type Palette } from './theme';

/** A table header cell with a full-word label and the NOTATION symbol in a tooltip. */
function HeaderCell({
  label,
  symbol,
  palette,
  align = 'right',
}: {
  readonly label: string;
  readonly symbol: string;
  readonly palette: Palette;
  readonly align?: 'left' | 'right';
}): ReactElement {
  return (
    <th style={{ ...thStyle(palette), textAlign: align }} title={symbol}>
      {label}
      <span style={symbolStyle(palette)}> {symbol}</span>
    </th>
  );
}

/** The per-hand energy table with a totals row (DESIGN.md §4.5, §6). */
export function EnergyPanel(): ReactElement {
  const palette = usePalette();
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
    <tr key={label} style={isTotal ? totalRowStyle(palette) : undefined}>
      <td style={{ ...tdStyle(palette), textAlign: 'left', fontWeight: isTotal ? 700 : 400 }}>
        {label}
      </td>
      {values.map((value, index) => (
        <td key={index} style={tdStyle(palette)}>
          {formatEnergy(value)}
        </td>
      ))}
    </tr>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle(palette)}>
          <thead>
            <tr>
              <th style={{ ...thStyle(palette), textAlign: 'left' }}>Hand</th>
              <HeaderCell label="Throw work" symbol="W⁺ (J/kg)" palette={palette} />
              <HeaderCell label="Catch absorption" symbol="|W⁻| (J/kg)" palette={palette} />
              <HeaderCell label="Average power" symbol="(W/kg)" palette={palette} />
            </tr>
          </thead>
          <tbody>
            {hands.map((row) =>
              rowCells(
                row.label,
                [row.workPositive, row.workNegativeMagnitude, row.averagePower],
                false,
              ),
            )}
            {rowCells(
              total.label,
              [total.workPositive, total.workNegativeMagnitude, total.averagePower],
              true,
            )}
          </tbody>
        </table>
      </div>
      <p style={captionStyle(palette)}>
        Per hand over one spatial period (beats 0–{periodEndBeat}; repeats every{' '}
        {report.periodTime.toFixed(3)} s). A hand&apos;s net contact work is W⁺ − |W⁻| = ΔKE + g·Δy
        over its carries (work–energy theorem; contact force is zero at every catch and release).
        Over a full period the pattern returns to steady state, so net summed across all hands is
        zero — a symmetric pattern already balances W⁺ and |W⁻| on each hand, while an asymmetric
        multi-hand pattern can split the load (one hand adds net energy, another absorbs it).
        Figures reflect the parameters in force at the start of the pattern; a live gravity or
        geometry change applies to future beats and does not move a past period&apos;s numbers.
      </p>
    </div>
  );
}

// --- Inline styling (theme-aware, dark-first) --------------------------------

function tableStyle(palette: Palette): CSSProperties {
  return {
    borderCollapse: 'collapse',
    fontSize: '0.72rem',
    minWidth: '19rem',
    color: palette.textPrimary,
  };
}

function thStyle(palette: Palette): CSSProperties {
  return {
    padding: '0.22rem 0.42rem',
    color: palette.textSecondary,
    fontWeight: 600,
    borderBottom: `1px solid ${palette.border}`,
    whiteSpace: 'nowrap',
  };
}

function symbolStyle(palette: Palette): CSSProperties {
  return { color: palette.textMuted, fontWeight: 400, fontSize: '0.64rem' };
}

function tdStyle(palette: Palette): CSSProperties {
  return {
    padding: '0.16rem 0.42rem',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    color: palette.textPrimary,
  };
}

function totalRowStyle(palette: Palette): CSSProperties {
  return { borderTop: `2px solid ${palette.borderStrong}`, background: palette.panelAlt };
}

function captionStyle(palette: Palette): CSSProperties {
  return { margin: 0, color: palette.textMuted, fontSize: '0.74rem', lineHeight: 1.4 };
}
