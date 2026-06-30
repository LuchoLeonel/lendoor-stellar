import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { KeypadAmount } from '../KeypadAmount';

afterEach(cleanup);

describe('KeypadAmount', () => {
  it('renders "$0" for empty value', () => {
    const { container } = render(<KeypadAmount value="" />);
    expect(container.textContent).toBe('$0');
  });

  it('renders integer input without forcing decimals', () => {
    const { container } = render(<KeypadAmount value="5" />);
    expect(container.textContent).toBe('$5');
  });

  it('respects typed cents (does not pad)', () => {
    const { container } = render(<KeypadAmount value="5.8" />);
    expect(container.textContent).toBe('$5.8');
  });

  it('splits sub-cent dust (3rd-6th decimals) into a superscript tail', () => {
    const { container } = render(<KeypadAmount value="0.846012" />);
    // Full text is preserved...
    expect(container.textContent).toBe('$0.846012');
    // ...with the dust ("6012") rendered in a <sup>.
    const sup = container.querySelector('sup');
    expect(sup?.textContent).toBe('6012');
  });

  it('keeps the head ($int.cents) outside the superscript', () => {
    const { container } = render(<KeypadAmount value="1234.567890" />);
    const sup = container.querySelector('sup');
    expect(sup?.textContent).toBe('7890');
    expect(container.textContent).toBe('$1234.567890');
  });
});
