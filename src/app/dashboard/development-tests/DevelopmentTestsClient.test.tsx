/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import DevelopmentTestsClient from './DevelopmentTestsClient';

const {
  successMock,
  errorMock,
  warningMock,
  infoMock,
  loadingMock,
  updateMock,
  createdMock,
  updatedMock,
  deletedMock,
  savedMock,
  validationErrorMock,
  networkErrorMock,
  unauthorizedMock,
  serverErrorMock,
  dismissMock,
} = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  warningMock: vi.fn(),
  infoMock: vi.fn(),
  loadingMock: vi.fn(),
  updateMock: vi.fn(),
  createdMock: vi.fn(),
  updatedMock: vi.fn(),
  deletedMock: vi.fn(),
  savedMock: vi.fn(),
  validationErrorMock: vi.fn(),
  networkErrorMock: vi.fn(),
  unauthorizedMock: vi.fn(),
  serverErrorMock: vi.fn(),
  dismissMock: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showToast: {
    success: successMock,
    error: errorMock,
    warning: warningMock,
    info: infoMock,
    loading: loadingMock,
    update: updateMock,
    created: createdMock,
    updated: updatedMock,
    deleted: deletedMock,
    saved: savedMock,
    validationError: validationErrorMock,
    networkError: networkErrorMock,
    unauthorized: unauthorizedMock,
    serverError: serverErrorMock,
    dismiss: dismissMock,
  },
}));

describe('DevelopmentTestsClient', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React?: typeof React }).React = React;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    loadingMock.mockReturnValue('loading-id');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders page headings and all toast action buttons', () => {
    render(<DevelopmentTestsClient />);

    expect(screen.getByText('Development Tests')).toBeInTheDocument();
    expect(screen.getByText('Toast Messages')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Success' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Error' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Warning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Info' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Loading -> Success Update' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Success With Action' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Created' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Updated' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deleted' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validation Error' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Network Error' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unauthorized' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Server Error' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss All Toasts' })).toBeInTheDocument();
  });

  it('fires corresponding toast helper calls for core toast actions', () => {
    render(<DevelopmentTestsClient />);

    fireEvent.click(screen.getByRole('button', { name: 'Success' }));
    expect(successMock).toHaveBeenCalledWith('Success toast');

    fireEvent.click(screen.getByRole('button', { name: 'Error' }));
    expect(errorMock).toHaveBeenCalledWith('Error toast');

    fireEvent.click(screen.getByRole('button', { name: 'Warning' }));
    expect(warningMock).toHaveBeenCalledWith('Warning toast');

    fireEvent.click(screen.getByRole('button', { name: 'Info' }));
    expect(infoMock).toHaveBeenCalledWith('Info toast');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss All Toasts' }));
    expect(dismissMock).toHaveBeenCalledWith();
  });

  it('starts a loading toast and updates it to success after timeout', () => {
    vi.useFakeTimers();
    render(<DevelopmentTestsClient />);

    fireEvent.click(screen.getByRole('button', { name: 'Loading -> Success Update' }));

    expect(loadingMock).toHaveBeenCalledWith('Loading toast', {
      description: 'Will auto-update to success in 2 seconds.',
    });
    expect(updateMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);

    expect(updateMock).toHaveBeenCalledWith('loading-id', 'success', 'Loading complete', {
      description: 'Update helper works.',
    });
  });
});
