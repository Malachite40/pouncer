import { redirect } from 'next/navigation';

export default function AddWatchRedirectPage() {
    redirect('/watches/new');
}
