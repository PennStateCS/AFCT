'use client';

import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';

export default function TestToastsPage() {
  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold mb-6">Toast Testing</h1>
      
      <div className="space-y-4">
        <Button 
          onClick={() => showToast.info('Great job!')}
          variant="outline"
        >
          Show Info Toast (Great job!)
        </Button>
        
        <Button 
          onClick={() => showToast.success('The server configuration changed.')}
          variant="outline"
        >
          Show Success Toast
        </Button>
        
        <Button 
          onClick={() => showToast.warning('The configuration changed.', {
            action: {
              label: 'Reload Server',
              onClick: () => console.log('Reload clicked')
            }
          })}
          variant="outline"
        >
          Show Warning Toast with Action
        </Button>
        
        <Button 
          onClick={() => showToast.error('Something went wrong!')}
          variant="outline"
        >
          Show Error Toast
        </Button>
        
        <Button 
          onClick={() => showToast.success('File uploaded successfully', {
            description: 'Your file has been processed and saved.'
          })}
          variant="outline"
        >
          Show Success with Description
        </Button>

        <Button 
          onClick={() => {
            showToast.info('First message');
            setTimeout(() => showToast.success('Second message'), 500);
            setTimeout(() => showToast.warning('Third message'), 1000);
            setTimeout(() => showToast.error('Fourth message'), 1500);
          }}
          variant="default"
        >
          Test Multiple Toast Stacking
        </Button>
      </div>
    </div>
  );
}
