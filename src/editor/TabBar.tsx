import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { closeTabAsk, newDiagram, switchTab } from '../io/actions';
import { useStore } from '../store/useStore';

/** drag type used to reorder tabs (file drops carry `Files` instead) */
const TAB_MIME = 'application/x-blockillustrator-tab';

/**
 * Document tabs (one per open diagram), Illustrator-style: click to switch, × or middle
 * click to close, drag to reorder, + for a new document. Files dropped here are opened
 * as documents (the App handles the drop; the strip only highlights).
 */
export function TabBar() {
  const t = useT();
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; before: boolean } | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  // the window title follows the active document
  useEffect(() => {
    const tab = tabs.find((x) => x.id === active);
    document.title = `${tab?.dirty ? '● ' : ''}${tab?.name ?? t('(無題)')} - Block Illustrator`;
  }, [tabs, active, t]);

  // keep the active tab visible when there are many
  useEffect(() => {
    stripRef.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length]);

  const untitled = t('(無題)');
  return (
    <div
      className={'tabbar' + (fileOver ? ' file-over' : '')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) setFileOver(true);
      }}
      onDragLeave={() => setFileOver(false)}
      onDrop={() => setFileOver(false)}
    >
      <div className="tabs" ref={stripRef} role="tablist">
        {tabs.map((tab) => {
          const name = tab.name ?? untitled;
          const ins = over?.id === tab.id && dragId && dragId !== tab.id ? (over.before ? ' ins-before' : ' ins-after') : '';
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === active}
              className={'tab' + (tab.id === active ? ' active' : '') + ins}
              title={name}
              draggable
              onDragStart={(e) => {
                setDragId(tab.id);
                e.dataTransfer.setData(TAB_MIME, tab.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragId(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(TAB_MIME)) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                const r = e.currentTarget.getBoundingClientRect();
                const before = e.clientX < r.left + r.width / 2;
                if (over?.id !== tab.id || over.before !== before) setOver({ id: tab.id, before });
              }}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes(TAB_MIME)) return;
                e.preventDefault();
                e.stopPropagation();
                const id = e.dataTransfer.getData(TAB_MIME) || dragId;
                setOver(null);
                setDragId(null);
                if (!id || id === tab.id) return;
                const list = useStore.getState().tabs;
                const from = list.findIndex((x) => x.id === id);
                let to = list.findIndex((x) => x.id === tab.id);
                if (!(over?.id === tab.id && over.before)) to++;
                if (from < to) to--;
                useStore.getState().moveTab(id, to);
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTabAsk(tab.id);
                }
              }}
              onClick={() => switchTab(tab.id)}
            >
              <span className="tab-name">{name}</span>
              <span className="tab-dirty" title={tab.dirty ? t('未保存の変更があります') : ''}>
                {tab.dirty ? '●' : ''}
              </span>
              <button
                className="tab-close"
                title={t('タブを閉じる') + ' (Ctrl+Alt+W)'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTabAsk(tab.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button className="tab-add" onClick={newDiagram} title={t('新しいタブ (Ctrl+Alt+N)')}>
          +
        </button>
      </div>
      <span className="tab-hint">{t('.bd / .pptx をここにドロップして開く')}</span>
    </div>
  );
}
