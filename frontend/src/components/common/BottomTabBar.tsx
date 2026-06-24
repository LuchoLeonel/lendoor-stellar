// src/components/common/BottomTabBar.tsx
'use client';

import * as React from 'react';
import { Home, Banknote } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export type Tab = 'inicio' | 'prestar' | 'progreso' | 'config';

type Props = {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  hasDebt?: boolean;
  isOverdue?: boolean;
};

const TABS: { id: Tab; icon: React.ElementType; labelKey: string; labelKeyDebt?: string }[] = [
  { id: 'inicio', icon: Home, labelKey: 'tabs.inicio' },
  { id: 'prestar', icon: Banknote, labelKey: 'tabs.prestar', labelKeyDebt: 'tabs.pagar' },
  // 'progreso' (se accede tocando el score) y 'config' (avatar) removidos del bottom bar.
];

export function BottomTabBar({ activeTab, onTabChange, hasDebt = false, isOverdue = false }: Props) {
  const { t } = useTranslation();
  const activeIndex = TABS.findIndex((tab) => tab.id === activeTab);

  return (
    <div
      className="
        fixed left-0 right-0
        z-50
        bg-white/80 backdrop-blur-xl border-t border-black/[0.04]
        flex items-center
      "
      style={{ height: '70px', bottom: 0 }}
    >
      {/* Sliding active indicator */}
      <div
        className="absolute top-0 h-[2.5px] rounded-full transition-all duration-300 ease-in-out"
        style={{
          backgroundColor: '#F97415',
          width: `${100 / TABS.length}%`,
          left: `${activeIndex * (100 / TABS.length)}%`,
        }}
      />

      {TABS.map(({ id, icon: Icon, labelKey, labelKeyDebt }) => {
        const isActive = activeTab === id;
        const key = hasDebt && labelKeyDebt ? labelKeyDebt : labelKey;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            className="
              relative flex-1 flex flex-col items-center justify-center gap-0.5
              py-2 px-1
              transition-colors duration-150
              focus:outline-none
            "
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon
              className="h-5 w-5"
              style={{ color: isActive ? '#F97415' : undefined }}
              strokeWidth={isActive ? 2.2 : 1.8}
              aria-hidden="true"
            />
            {id === 'prestar' && isOverdue && !isActive && (
              <div
                className="absolute top-1 right-[calc(50%-2px)] h-2 w-2 rounded-full bg-red-500"
                style={{ boxShadow: '0 0 4px rgba(239,68,68,0.5)' }}
              />
            )}
            <span
              className="text-[10px] font-medium leading-none"
              style={{ color: isActive ? '#F97415' : undefined }}
            >
              {t(key)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
