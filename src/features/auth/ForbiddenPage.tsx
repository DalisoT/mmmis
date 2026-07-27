import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { BrandLockup } from '@/components/brand/BrandMark';

export function ForbiddenPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <BrandLockup showDescription={false} className="mb-6" />
        <h1 className="text-3xl font-bold tracking-tight">403 — Access Denied</h1>
        <p className="mt-2 text-muted-foreground">
          Your role does not have permission to view this page.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
