'use client';

import { useMemo, useState } from 'react';
import type { BlockedExtensionRow } from '@/lib/extension/repository';

interface Props {
  initialExtensions: BlockedExtensionRow[];
  initialCustomCount: number;
  maxCustom: number;
  maxLength: number;
}

type Feedback = { kind: 'error' | 'success'; text: string } | null;

export default function PolicyEditor({
  initialExtensions,
  initialCustomCount,
  maxCustom,
  maxLength,
}: Props) {
  const [extensions, setExtensions] = useState(initialExtensions);
  const [customCount, setCustomCount] = useState(initialCustomCount);
  const [input, setInput] = useState('');
  const [message, setMessage] = useState<Feedback>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const fixed = useMemo(
    () => extensions.filter((e) => e.type === 'FIXED'),
    [extensions]
  );
  // 명세: 고정 확장자는 커스텀 영역에 표시되지 않는다.
  const custom = useMemo(
    () => extensions.filter((e) => e.type === 'CUSTOM'),
    [extensions]
  );

  const atLimit = customCount >= maxCustom;
  const blockedCount = extensions.filter((e) => e.isBlocked).length;

  function markBusy(id: string, busy: boolean) {
    setBusyIds((s) => {
      const n = new Set(s);
      if (busy) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  // ── 고정 확장자 토글 ────────────────────────────────────────────────────
  async function toggleFixed(row: BlockedExtensionRow, next: boolean) {
    markBusy(row.id, true);
    setMessage(null);

    // 낙관적 업데이트: 체크박스는 즉시 반응해야 한다.
    setExtensions((list) =>
      list.map((e) => (e.id === row.id ? { ...e, isBlocked: next } : e))
    );

    try {
      const res = await fetch(`/api/extensions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isBlocked: next }),
      });

      if (!res.ok) {
        // 롤백 없는 낙관적 업데이트는 "저장된 줄 알았는데 아니었다"를 만든다.
        // 보안 설정에서 이건 치명적이다.
        setExtensions((list) =>
          list.map((e) => (e.id === row.id ? { ...e, isBlocked: !next } : e))
        );
        const body = await safeJson(res);
        setMessage({
          kind: 'error',
          text: body?.message ?? '정책 변경에 실패했습니다.',
        });
      }
    } catch {
      setExtensions((list) =>
        list.map((e) => (e.id === row.id ? { ...e, isBlocked: !next } : e))
      );
      setMessage({ kind: 'error', text: '서버에 연결할 수 없습니다.' });
    } finally {
      markBusy(row.id, false);
    }
  }

  // ── 커스텀 확장자 추가 ──────────────────────────────────────────────────
  async function addCustom(e: React.FormEvent) {
    e.preventDefault();
    if (adding) return;

    const value = input.trim();
    if (!value) return;

    setAdding(true);
    setMessage(null);

    try {
      const res = await fetch('/api/extensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extension: value }),
      });

      const body = await safeJson(res);

      if (!res.ok) {
        // 중복(409) / 개수 초과(409) / 형식 오류(400) 모두 서버 사유를 그대로 보여준다.
        setMessage({
          kind: 'error',
          text: body?.message ?? '확장자를 추가하지 못했습니다.',
        });
        return;
      }

      setExtensions((list) => [...list, body.extension]);
      setCustomCount((c) => c + 1);
      setInput('');
      setMessage({
        kind: 'success',
        text: `'${body.extension.extension}' 을(를) 차단 목록에 추가했습니다.`,
      });
    } catch {
      setMessage({ kind: 'error', text: '서버에 연결할 수 없습니다.' });
    } finally {
      setAdding(false);
    }
  }

  // ── 커스텀 확장자 삭제 ──────────────────────────────────────────────────
  async function removeCustom(row: BlockedExtensionRow) {
    markBusy(row.id, true);
    setMessage(null);

    const snapshot = extensions;
    setExtensions((list) => list.filter((e) => e.id !== row.id));
    setCustomCount((c) => c - 1);

    try {
      const res = await fetch(`/api/extensions/${row.id}`, { method: 'DELETE' });
      if (!res.ok) {
        setExtensions(snapshot);
        setCustomCount((c) => c + 1);
        setMessage({ kind: 'error', text: '삭제에 실패했습니다.' });
      }
    } catch {
      setExtensions(snapshot);
      setCustomCount((c) => c + 1);
      setMessage({ kind: 'error', text: '서버에 연결할 수 없습니다.' });
    } finally {
      markBusy(row.id, false);
    }
  }

  return (
    <>
      <div className="policy-summary">
        현재 <strong>{blockedCount}</strong>개 확장자가 차단 중입니다.
      </div>

      {/* ============ 고정 확장자 ============ */}
      <section>
        <h2>고정 확장자</h2>
        <p className="hint">
          자주 차단하는 확장자입니다. 기본값은 모두 해제 상태이며, 체크하면 즉시
          저장되어 새로고침해도 유지됩니다.
        </p>

        <div className="fixed-list">
          {fixed.map((row) => (
            <label
              key={row.id}
              className={`fixed-item${busyIds.has(row.id) ? ' busy' : ''}`}
            >
              <input
                type="checkbox"
                checked={row.isBlocked}
                onChange={(e) => toggleFixed(row, e.target.checked)}
              />
              {row.extension}
            </label>
          ))}
        </div>
      </section>

      {/* ============ 커스텀 확장자 ============ */}
      <section>
        <h2>커스텀 확장자</h2>
        <p className="hint">
          최대 {maxLength}자, {maxCustom}개까지 추가할 수 있습니다. 대소문자와 앞의
          점은 무시되므로 <code>EXE</code>, <code>.exe</code>, <code>exe</code> 는
          모두 같은 확장자로 처리됩니다.
        </p>

        <form className="custom-form" onSubmit={addCustom}>
          <input
            type="text"
            value={input}
            maxLength={maxLength}
            placeholder="예: sh"
            aria-label="추가할 확장자"
            onChange={(e) => setInput(e.target.value)}
            disabled={atLimit}
          />
          <button type="submit" disabled={adding || atLimit || !input.trim()}>
            {adding ? '추가 중…' : '추가'}
          </button>
        </form>

        <div className={`counter${atLimit ? ' warn' : ''}`}>
          {customCount} / {maxCustom}
          {atLimit && ' — 최대 개수에 도달했습니다.'}
        </div>

        <div className="chip-area">
          {custom.length === 0 ? (
            <span className="empty">추가된 커스텀 확장자가 없습니다.</span>
          ) : (
            custom.map((row) => (
              <span key={row.id} className="chip">
                {row.extension}
                <button
                  type="button"
                  aria-label={`${row.extension} 삭제`}
                  disabled={busyIds.has(row.id)}
                  onClick={() => removeCustom(row)}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>

        {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
      </section>
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
