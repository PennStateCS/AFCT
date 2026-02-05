'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function SubmissionsModule() {
  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle className="text-lg font-semibold">Submissions</CardTitle>
        <Badge variant="outline" className="bg-blue-50 text-blue-700">
          Beta Feature
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground">Nothing to grade.</p>
      </CardContent>
    </Card>
  );
}
