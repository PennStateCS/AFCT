/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ProblemHeader from './ProblemHeader';

describe('ProblemHeader', () => {
  it('renders title, description, and metadata badges', () => {
    render(
      <ProblemHeader
        title="Deterministic FA"
        description="Build a DFA for the language."
        type="FA"
        maxStates={6}
        isDeterministic={true}
        maxSubmissions={3}
        autograderEnabled={true}
      />,
    );

    expect(screen.getByText('Deterministic FA')).toBeInTheDocument();
    expect(screen.getByText('Build a DFA for the language.')).toBeInTheDocument();
    expect(screen.getByText('Finite Automaton')).toBeInTheDocument();
    expect(screen.getByText('Max States: 6')).toBeInTheDocument();
    expect(screen.getByText('Deterministic')).toBeInTheDocument();
    expect(screen.getByText('Max Submissions: 3')).toBeInTheDocument();
    expect(screen.getByText('Autograder: On')).toBeInTheDocument();
  });

  it('handles unknown type and unlimited values', () => {
    render(
      <ProblemHeader
        title="Custom Problem"
        type="CUSTOM"
        maxStates={-1}
        isDeterministic={false}
        maxSubmissions={-1}
        autograderEnabled={false}
      />,
    );

    expect(screen.getByText('CUSTOM')).toBeInTheDocument();
    expect(screen.getByText('Max States: Unlimited')).toBeInTheDocument();
    expect(screen.getByText('Nondeterministic')).toBeInTheDocument();
    expect(screen.getByText('Max Submissions: Unlimited')).toBeInTheDocument();
    expect(screen.getByText('Autograder: Off')).toBeInTheDocument();
  });
});
