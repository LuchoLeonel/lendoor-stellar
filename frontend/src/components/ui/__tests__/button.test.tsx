import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../button';

describe('Button component', () => {
  describe('rendering', () => {
    it('renders with default text', () => {
      render(<Button>Click me</Button>);
      expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
    });

    it('renders a native button element by default', () => {
      render(<Button>Test</Button>);
      const btn = screen.getByRole('button');
      expect(btn.tagName).toBe('BUTTON');
    });

    it('has data-slot="button" attribute', () => {
      render(<Button>Test</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('data-slot', 'button');
    });
  });

  describe('variants', () => {
    it('applies default variant classes (amber background)', () => {
      render(<Button variant="default">Default</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('bg-amber-400');
    });

    it('applies destructive variant classes', () => {
      render(<Button variant="destructive">Delete</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('bg-destructive');
    });

    it('applies outline variant classes', () => {
      render(<Button variant="outline">Outline</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('border');
    });

    it('applies ghost variant classes', () => {
      render(<Button variant="ghost">Ghost</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('hover:bg-accent');
    });

    it('applies link variant classes', () => {
      render(<Button variant="link">Link</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('underline-offset-4');
    });
  });

  describe('sizes', () => {
    it('applies default size class', () => {
      render(<Button size="default">Default Size</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('h-9');
    });

    it('applies sm size class', () => {
      render(<Button size="sm">Small</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('h-8');
    });

    it('applies lg size class', () => {
      render(<Button size="lg">Large</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('h-10');
    });

    it('applies xl size class', () => {
      render(<Button size="xl">XL</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('h-12');
    });

    it('applies icon size class', () => {
      render(<Button size="icon">Icon</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('size-9');
    });
  });

  describe('disabled state', () => {
    it('is disabled when disabled prop is passed', () => {
      render(<Button disabled>Disabled</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('applies disabled opacity classes', () => {
      render(<Button disabled>Disabled</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('disabled:opacity-50');
    });

    it('does not call onClick when disabled', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(<Button disabled onClick={handleClick}>Disabled</Button>);

      await user.click(screen.getByRole('button'));

      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe('click handler', () => {
    it('calls onClick when clicked', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Click me</Button>);

      await user.click(screen.getByRole('button'));

      expect(handleClick).toHaveBeenCalledOnce();
    });

    it('calls onClick multiple times on multiple clicks', async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Click</Button>);

      await user.click(screen.getByRole('button'));
      await user.click(screen.getByRole('button'));

      expect(handleClick).toHaveBeenCalledTimes(2);
    });
  });

  describe('custom className', () => {
    it('merges custom className with variant classes', () => {
      render(<Button className="custom-class">Custom</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('custom-class');
    });
  });

  describe('asChild prop', () => {
    it('renders child element as the root when asChild is true', () => {
      render(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>
      );
      const link = screen.getByRole('link', { name: 'Link Button' });
      expect(link).toBeInTheDocument();
      expect(link.tagName).toBe('A');
    });
  });

  describe('type attribute', () => {
    it('passes type attribute to button element', () => {
      render(<Button type="submit">Submit</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    });
  });

  describe('aria attributes', () => {
    it('can have aria-label', () => {
      render(<Button aria-label="close dialog">X</Button>);
      expect(screen.getByRole('button', { name: 'close dialog' })).toBeInTheDocument();
    });
  });
});
