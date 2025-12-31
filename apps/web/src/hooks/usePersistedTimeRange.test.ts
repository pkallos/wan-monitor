import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePersistedTimeRange } from '@/hooks/usePersistedTimeRange';

const STORAGE_KEY = 'wan-monitor-date-range';

describe('usePersistedTimeRange', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should default to 1h when no saved value exists', () => {
    const { result } = renderHook(() => usePersistedTimeRange());
    expect(result.current.timeRange).toBe('1h');
  });

  it('should restore saved value from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, '7d');
    const { result } = renderHook(() => usePersistedTimeRange());
    expect(result.current.timeRange).toBe('7d');
  });

  it('should persist selection to localStorage when changed', () => {
    const { result } = renderHook(() => usePersistedTimeRange());

    act(() => {
      result.current.setTimeRange('24h');
    });

    expect(result.current.timeRange).toBe('24h');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('24h');
  });

  it('should fall back to default for invalid localStorage values', () => {
    localStorage.setItem(STORAGE_KEY, 'invalid-value');
    const { result } = renderHook(() => usePersistedTimeRange());
    expect(result.current.timeRange).toBe('1h');
  });

  it('should fall back to default for empty localStorage value', () => {
    localStorage.setItem(STORAGE_KEY, '');
    const { result } = renderHook(() => usePersistedTimeRange());
    expect(result.current.timeRange).toBe('1h');
  });

  it('should handle localStorage errors gracefully on read', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    getItemSpy.mockImplementation(() => {
      throw new Error('localStorage unavailable');
    });

    const { result } = renderHook(() => usePersistedTimeRange());
    expect(result.current.timeRange).toBe('1h');

    getItemSpy.mockRestore();
  });

  it('should handle localStorage errors gracefully on write', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    setItemSpy.mockImplementation(() => {
      throw new Error('localStorage unavailable');
    });

    const { result } = renderHook(() => usePersistedTimeRange());

    act(() => {
      result.current.setTimeRange('30d');
    });

    // State should still update even if localStorage fails
    expect(result.current.timeRange).toBe('30d');

    setItemSpy.mockRestore();
  });

  it('should accept all valid time range values', () => {
    const { result } = renderHook(() => usePersistedTimeRange());

    const validRanges = ['1h', '24h', '7d', '30d'] as const;

    for (const range of validRanges) {
      act(() => {
        result.current.setTimeRange(range);
      });
      expect(result.current.timeRange).toBe(range);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(range);
    }
  });
});
