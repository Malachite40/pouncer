import { Suspense } from 'react';
import AlertsContent from './alerts-content';

export default function AlertsPage() {
    return (
        <Suspense>
            <AlertsContent />
        </Suspense>
    );
}
