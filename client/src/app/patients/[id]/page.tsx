import { redirect } from 'next/navigation';

export default async function PatientPage({ params }: { params: Promise<{ id?: string }> }) {
  const resolved = await params;
  const id = resolved?.id ? String(resolved.id) : '';
  if (!id) {
    redirect('/patients');
  }
  redirect(`/patients/${encodeURIComponent(id)}/upload`);
}
