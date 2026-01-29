import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function SystemSettingsPage() {
  return (
    <div className="space-y-4 pb-8">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-2xl">System Settings</CardTitle>
            <Badge variant="outline" className="bg-blue-50 text-blue-700">
              Preview
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            Configuration tools will be added here over time.
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">General</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid max-w-xl gap-4">
            <div className="grid gap-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Input
                id="timezone"
                name="timezone"
                placeholder="America/New_York"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                This will control how dates and times are displayed across the admin dashboard.
              </p>
            </div>
            <div>
              <Button type="button" disabled>
                Save changes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}