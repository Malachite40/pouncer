'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type WatchboardPriceChartStore = {
    hiddenWatchIds: string[];
    ultraMinimal: boolean;
    hasHydrated: boolean;
    toggleWatch: (id: string) => void;
    toggleUltraMinimal: () => void;
    showAll: () => void;
    pruneHiddenWatchIds: (validIds: string[]) => void;
    markHydrated: () => void;
};

export const useWatchboardPriceChartStore = create<WatchboardPriceChartStore>()(
    persist(
        (set) => ({
            hiddenWatchIds: [],
            ultraMinimal: false,
            hasHydrated: false,
            toggleWatch: (id) =>
                set((state) => ({
                    hiddenWatchIds: state.hiddenWatchIds.includes(id)
                        ? state.hiddenWatchIds.filter(
                              (hiddenId) => hiddenId !== id,
                          )
                        : [...state.hiddenWatchIds, id],
                })),
            toggleUltraMinimal: () =>
                set((state) => ({
                    ultraMinimal: !state.ultraMinimal,
                })),
            showAll: () => set({ hiddenWatchIds: [] }),
            pruneHiddenWatchIds: (validIds) =>
                set((state) => {
                    const validIdSet = new Set(validIds);
                    const nextHiddenWatchIds = state.hiddenWatchIds.filter(
                        (id) => validIdSet.has(id),
                    );

                    return nextHiddenWatchIds.length ===
                        state.hiddenWatchIds.length
                        ? state
                        : { hiddenWatchIds: nextHiddenWatchIds };
                }),
            markHydrated: () => set({ hasHydrated: true }),
        }),
        {
            name: 'watchboard-price-chart',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                hiddenWatchIds: state.hiddenWatchIds,
                ultraMinimal: state.ultraMinimal,
            }),
            onRehydrateStorage: () => (state) => {
                state?.markHydrated();
            },
        },
    ),
);
