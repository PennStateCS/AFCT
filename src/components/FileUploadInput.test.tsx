/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import FileUploadInput from './FileUploadInput';

const baseProps = { id: 'up', label: 'Upload file', name: 'file', maxSizeMb: 1 };

function makeFile(name: string, sizeBytes: number) {
  const f = new File(['x'], name, { type: 'text/xml' });
  Object.defineProperty(f, 'size', { value: sizeBytes });
  return f;
}

const getInput = () => screen.getByLabelText('Upload file', { selector: 'input' });

describe('FileUploadInput', () => {
  it('associates the label with the file input and sets no dangling describedby', () => {
    render(<FileUploadInput {...baseProps} onChange={vi.fn()} />);

    const input = getInput();
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('id', 'up');
    // No hint and no error -> no aria-describedby pointing at a non-existent node.
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('describes the input with the help node only when a hint is provided', () => {
    render(<FileUploadInput {...baseProps} hint="XML only" onChange={vi.fn()} />);

    expect(getInput()).toHaveAttribute('aria-describedby', 'up-help');
    expect(screen.getByText('XML only')).toHaveAttribute('id', 'up-help');
  });

  it('accepts a valid file and calls onChange with it', () => {
    const onChange = vi.fn();
    render(<FileUploadInput {...baseProps} onChange={onChange} />);

    const file = makeFile('ok.xml', 1024);
    fireEvent.change(getInput(), { target: { files: [file] } });

    expect(onChange).toHaveBeenCalledWith(file);
  });

  it('rejects an oversize file with an announced error and clears the value', () => {
    const onChange = vi.fn();
    render(<FileUploadInput {...baseProps} onChange={onChange} />);

    fireEvent.change(getInput(), { target: { files: [makeFile('big.xml', 5 * 1024 * 1024)] } });

    expect(onChange).toHaveBeenCalledWith(undefined);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/exceeds limit of 1MB/);
    // The input is now described by the error node.
    expect(getInput()).toHaveAttribute('aria-describedby', 'up-error');
  });

  it('surfaces an external error through role=alert', () => {
    render(<FileUploadInput {...baseProps} error="Server rejected it" onChange={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Server rejected it');
  });

  it('shows the selected filename with a full-value title and can clear it', () => {
    const onChange = vi.fn();
    render(<FileUploadInput {...baseProps} value={makeFile('my-solution.xml', 2048)} onChange={onChange} />);

    expect(screen.getByText('my-solution.xml')).toHaveAttribute('title', 'my-solution.xml');

    fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('handles a dropped file', () => {
    const onChange = vi.fn();
    render(<FileUploadInput {...baseProps} onChange={onChange} />);

    const zone = getInput().parentElement as HTMLElement;
    const file = makeFile('dropped.xml', 512);
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    expect(onChange).toHaveBeenCalledWith(file);
  });

  it('does not accept a drop while disabled', () => {
    const onChange = vi.fn();
    render(<FileUploadInput {...baseProps} disabled onChange={onChange} />);

    const zone = getInput().parentElement as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [makeFile('x.xml', 512)] } });

    expect(onChange).not.toHaveBeenCalled();
  });
});
