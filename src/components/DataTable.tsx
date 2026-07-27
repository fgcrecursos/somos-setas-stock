import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right' | 'center';
  className?: string;
  sortable?: boolean;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  defaultSort?: string;
  emptyLabel?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  defaultSort,
  emptyLabel,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSort ?? null);
  const [dir, setDir] = useState<1 | -1>(1);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return arr;
  }, [rows, sortKey, dir, columns]);

  function toggle(key: string, sortable?: boolean) {
    if (sortable === false) return;
    if (sortKey === key) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setDir(1);
    }
  }

  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={
                  (c.align === 'right' ? 'num ' : '') +
                  (c.sortable === false || !c.sortValue ? 'no-sort' : '')
                }
                style={{ textAlign: c.align }}
                onClick={() => c.sortValue && toggle(c.key, c.sortable)}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {c.header}
                  {sortKey === c.key &&
                    (dir === 1 ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={(c.align === 'right' ? 'num ' : '') + (c.className ?? '')}
                  style={{ textAlign: c.align }}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length}>
                <div className="empty">{emptyLabel ?? 'Sin resultados'}</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
