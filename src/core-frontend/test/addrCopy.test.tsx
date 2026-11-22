// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AddrCopy } from '../src/components/servers/serverUi';

afterEach(cleanup);

describe('the address on a server card', () => {
  it('shows the port once when the address is split into host and port', () => {
    const { container } = render(<AddrCopy address="203.0.113.10:27015" split />);
    expect(container.textContent).toBe('203.0.113.10:27015');
    expect(container.querySelector('.srv-addr-port')?.textContent).toBe(':27015');
    expect(container.querySelector('.srv-addr-host')?.textContent).toBe('203.0.113.10');
  });
  it('keeps an address without a port as it is', () => {
    const { container } = render(<AddrCopy address="play.example.com" split />);
    expect(container.textContent).toBe('play.example.com');
  });
});
