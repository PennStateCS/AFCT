/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card';

describe('CardTitle', () => {
  it('is a heading by default at level 3 (repairs the page outline)', () => {
    render(<CardTitle>Section</CardTitle>);

    const heading = screen.getByRole('heading', { name: 'Section' });
    expect(heading).toHaveAttribute('aria-level', '3');
    expect(heading).toHaveAttribute('data-slot', 'card-title');
  });

  it('honors an explicit aria-level', () => {
    render(<CardTitle aria-level={1}>Page</CardTitle>);

    expect(screen.getByRole('heading', { name: 'Page', level: 1 })).toBeInTheDocument();
  });

  it('can opt out of the heading role, and then carries no aria-level', () => {
    render(<CardTitle role="presentation">Plain</CardTitle>);

    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('Plain')).not.toHaveAttribute('aria-level');
  });

  it('merges a custom className onto the title', () => {
    render(<CardTitle className="custom-title">X</CardTitle>);

    expect(screen.getByRole('heading', { name: 'X' })).toHaveClass('custom-title');
  });
});

describe('Card structure', () => {
  it('renders each region with its data-slot', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Desc</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Foot</CardFooter>
      </Card>,
    );

    expect(screen.getByText('Body')).toHaveAttribute('data-slot', 'card-content');
    expect(screen.getByText('Desc')).toHaveAttribute('data-slot', 'card-description');
    expect(screen.getByText('Foot')).toHaveAttribute('data-slot', 'card-footer');
  });
});
