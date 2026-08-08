/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

  describe('rich descriptions', () => {
    const richDoc = {
      version: 1,
      document: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Build a ' },
              { type: 'text', text: 'minimal', marks: [{ type: 'bold' }] },
              { type: 'text', text: ' DFA for ' },
              { type: 'inlineMath', attrs: { latex: 'a^n b^n' } },
            ],
          },
        ],
      },
    };

    it('renders formatting and maths when the problem has a stored document', async () => {
      const { container } = render(
        <ProblemHeader
          title="Problem 1"
          description="Build a minimal DFA for $a^n b^n$"
          descriptionJson={richDoc}
        />,
      );

      expect(container.querySelector('strong')?.textContent).toBe('minimal');
      // KaTeX is fetched on demand, so an equation shows its source for a moment first.
      await waitFor(() => {
        expect(container.querySelector('[data-type="inline-math"] math')).not.toBeNull();
      });
      // A problem header is a tight surface, so it asks for the compact density.
      expect(container.querySelector('.afct-rich-text--compact')).not.toBeNull();
    });

    it('falls back to the plain text for a legacy problem', () => {
      render(<ProblemHeader title="Problem 1" description={'line one\nline two'} />);
      expect(screen.getByText(/line one/)).toBeInTheDocument();
    });

    it('renders no description block when the problem has neither form', () => {
      const { container } = render(<ProblemHeader title="Problem 1" />);
      expect(container.querySelector('.afct-rich-text')).toBeNull();
    });
  });
});

describe('the facts bar', () => {
  // The bar is the description's header, so the two have to stay one unit rather than a row
  // of pills floating above unrelated text.
  it('puts the description in the same box as the facts', () => {
    render(
      <ProblemHeader
        title="Deterministic FA"
        description="Build a DFA for the language."
        type="FA"
        maxStates={6}
      />,
    );

    const facts = screen.getByText('Finite Automaton').closest('section');
    expect(facts).not.toBeNull();
    expect(facts).toHaveTextContent('Build a DFA for the language.');
  });

  it('renders the bar alone when the problem has no description', () => {
    render(<ProblemHeader title="No description" type="FA" maxStates={6} />);

    const section = screen.getByText('Finite Automaton').closest('section');
    expect(section).toHaveTextContent('Max States: 6');
  });

  // Nothing to say means no empty box.
  it('renders no box when there is neither a description nor any facts', () => {
    const { container } = render(<ProblemHeader title="Bare" />);

    expect(container.querySelector('section')).toBeNull();
  });
});
