import { useCallback, useState } from 'react';

export function usePagination({ totalPages }: { totalPages: number }) {
    const [page, setPage] = useState(1);

    const canGoNext = page < totalPages;
    const canGoPrev = page > 1;

    const nextPage = useCallback(() => {
        setPage((p) => Math.min(p + 1, totalPages));
    }, [totalPages]);

    const prevPage = useCallback(() => {
        setPage((p) => Math.max(p - 1, 1));
    }, []);

    const resetPage = useCallback(() => {
        setPage(1);
    }, []);

    return { page, setPage, canGoNext, canGoPrev, nextPage, prevPage, resetPage };
}
