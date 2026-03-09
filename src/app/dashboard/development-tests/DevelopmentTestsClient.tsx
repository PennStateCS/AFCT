'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { showToast } from '@/lib/toast';

export default function DevelopmentTestsClient() {
  return (
    <div className="space-y-4 pb-8">
      <Card aria-labelledby="development-tests-title">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <CardTitle id="development-tests-title" className="text-2xl">
              Development Tests
            </CardTitle>
            <Badge variant="outline" className="bg-blue-50 text-blue-700">
              Dev Only
            </Badge>
          </div>
          <div className="text-muted-foreground text-sm">
            Trigger each toast style used across the app.
          </div>
        </CardHeader>
      </Card>

      <Card aria-labelledby="toast-tests-title">
        <CardHeader>
          <CardTitle id="toast-tests-title" className="text-lg">
            Toast Messages
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Button type="button" onClick={() => showToast.success('Success toast')}>
              Success
            </Button>
            <Button type="button" onClick={() => showToast.error('Error toast')}>
              Error
            </Button>
            <Button type="button" onClick={() => showToast.warning('Warning toast')}>
              Warning
            </Button>
            <Button type="button" onClick={() => showToast.info('Info toast')}>
              Info
            </Button>
            <Button
              type="button"
              onClick={() => {
                const id = showToast.loading('Loading toast', {
                  description: 'Will auto-update to success in 2 seconds.',
                });
                window.setTimeout(() => {
                  showToast.update(id, 'success', 'Loading complete', {
                    description: 'Update helper works.',
                  });
                }, 2000);
              }}
            >
              Loading -&gt; Success Update
            </Button>
            <Button
              type="button"
              onClick={() =>
                showToast.success('Success with action', {
                  action: { label: 'Undo', onClick: () => showToast.info('Undo clicked') },
                })
              }
            >
              Success With Action
            </Button>
            <Button type="button" onClick={() => showToast.created('Course')}>
              Created
            </Button>
            <Button type="button" onClick={() => showToast.updated('Profile')}>
              Updated
            </Button>
            <Button type="button" onClick={() => showToast.deleted('Submission')}>
              Deleted
            </Button>
            <Button type="button" onClick={() => showToast.saved('Settings')}>
              Saved
            </Button>
            <Button
              type="button"
              onClick={() =>
                showToast.validationError('Example: One or more required fields are missing.')
              }
            >
              Validation Error
            </Button>
            <Button type="button" onClick={() => showToast.networkError()}>
              Network Error
            </Button>
            <Button type="button" onClick={() => showToast.unauthorized()}>
              Unauthorized
            </Button>
            <Button type="button" onClick={() => showToast.serverError()}>
              Server Error
            </Button>
            <Button type="button" variant="outline" onClick={() => showToast.dismiss()}>
              Dismiss All Toasts
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
