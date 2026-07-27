'use client';

import { useRef, useState } from 'react';
import type { UploadRecordRow } from '@/lib/upload/repository';

interface Props {
  initialUploads: UploadRecordRow[];
  maxFileSizeMB: number;
}

type Feedback = { kind: 'error' | 'success'; text: string } | null;

export default function UploadPanel({ initialUploads, maxFileSizeMB }: Props) {
  const [uploads, setUploads] = useState(initialUploads);
  const [message, setMessage] = useState<Feedback>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  function pick(file: File | null) {
    setPicked(file);
    setMessage(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = picked ?? fileRef.current?.files?.[0] ?? null;
    if (!file || uploading) return;

    setUploading(true);
    setMessage(null);

    // 여기서 확장자를 미리 거르지 않는다.
    // "화면에서 걸러졌다"가 아니라 "서버가 막았다"를 보여주는 것이 이 기능의 요구사항이다.
    // 클라이언트 검증을 넣으면 서버가 실제로 막는지 확인할 방법이 사라진다.
    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const body = await safeJson(res);

      if (!res.ok) {
        setMessage({
          kind: 'error',
          text: `${body?.message ?? '업로드가 거부되었습니다.'}`,
        });
        setLastCode(body?.code ?? 'UNKNOWN');
      } else {
        setMessage({
          kind: 'success',
          text: body.file.persisted
            ? `업로드 완료 — 저장명 ${body.file.storedName}`
            : '검증 통과 — 이 환경에서는 파일 본문을 보관하지 않습니다(STORAGE_DRIVER=none).',
        });
        setLastCode(null);
        reset();
      }

      await refresh();
    } catch {
      setMessage({ kind: 'error', text: '서버에 연결할 수 없습니다.' });
      setLastCode(null);
    } finally {
      setUploading(false);
    }
  }

  const [lastCode, setLastCode] = useState<string | null>(null);

  function reset() {
    setPicked(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function refresh() {
    try {
      const res = await fetch('/api/uploads');
      if (res.ok) setUploads((await res.json()).uploads);
    } catch {
      /* 목록 갱신 실패가 업로드 결과 표시를 방해하지 않게 한다 */
    }
  }

  return (
    <>
      <section>
        <h2>파일 선택</h2>
        <p className="hint">
          설정된 차단 정책이 서버에서 강제됩니다. 화면에서 미리 거르지 않고 그대로
          전송한 뒤, 서버의 판정 결과를 표시합니다. (최대 {maxFileSizeMB}MB)
        </p>

        <form onSubmit={submit}>
          <div
            className={`dropzone${dragging ? ' dragging' : ''}${
              picked ? ' filled' : ''
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files?.[0] ?? null);
            }}
            onClick={() => fileRef.current?.click()}
          >
            <input
              type="file"
              ref={fileRef}
              hidden
              aria-label="업로드할 파일"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />

            {picked ? (
              <>
                <strong className="mono">{picked.name}</strong>
                <span className="dropzone-sub">
                  {formatBytes(picked.size)} · 클릭하면 다른 파일 선택
                </span>
              </>
            ) : (
              <>
                <strong>파일을 끌어다 놓거나 클릭해서 선택하세요</strong>
                <span className="dropzone-sub">
                  차단 대상 파일도 그대로 시도할 수 있습니다
                </span>
              </>
            )}
          </div>

          <div className="upload-actions">
            <button type="submit" disabled={uploading || !picked}>
              {uploading ? '검증 중…' : '업로드'}
            </button>
            {picked && !uploading && (
              <button type="button" className="ghost" onClick={reset}>
                선택 취소
              </button>
            )}
          </div>
        </form>

        {message && (
          <div className={`alert ${message.kind}`}>
            {message.text}
            {lastCode && (
              <>
                {' '}
                <code>사유 코드: {lastCode}</code>
              </>
            )}
          </div>
        )}
      </section>

      <section>
        <h2>최근 업로드 시도</h2>
        <p className="hint">
          차단된 시도도 함께 기록합니다. 우회 시도를 탐지할 수 있는 유일한
          신호이기 때문입니다.
        </p>

        {uploads.length === 0 ? (
          <div className="empty">아직 기록이 없습니다.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 72 }}>결과</th>
                <th>파일명</th>
                <th style={{ width: 210 }}>사유 / 판별 형식</th>
                <th style={{ width: 80 }}>시각</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span
                      className={`badge ${
                        u.status === 'ACCEPTED' ? 'accepted' : 'rejected'
                      }`}
                    >
                      {u.status === 'ACCEPTED' ? '허용' : '차단'}
                    </span>
                  </td>
                  <td className="mono">{u.originalName}</td>
                  <td className="mono">
                    {u.rejectReason ?? u.sniffedType ?? '-'}
                    {u.matchedExtension ? ` (.${u.matchedExtension})` : ''}
                  </td>
                  <td>{new Date(u.createdAt).toLocaleTimeString('ko-KR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
