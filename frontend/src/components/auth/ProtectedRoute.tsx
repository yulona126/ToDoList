import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../stores/AuthContext';

export interface FromLocation {
  pathname: string;
  search: string;
}

/** Narrow `location.state.from` (react-router passes it through untouched). */
export function readFrom(state: unknown): FromLocation | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const from = (state as { from?: unknown }).from;
  if (typeof from !== 'object' || from === null) return undefined;
  const { pathname, search } = from as {
    pathname?: unknown;
    search?: unknown;
  };
  if (typeof pathname !== 'string') return undefined;
  return { pathname, search: typeof search === 'string' ? search : '' };
}

/**
 * Layout route guarding every authenticated page. The intended destination is
 * preserved in `location.state.from` so LoginPage can bounce back after sign-in
 * (architecture §8.3).
 */
export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

/** Inverse guard: signed-in users never see /login or /register. */
export function PublicOnlyRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (isAuthenticated) {
    const from = readFrom(location.state);
    const target =
      from && from.pathname !== '/login' && from.pathname !== '/register'
        ? `${from.pathname}${from.search}`
        : '/';
    return <Navigate to={target} replace />;
  }
  return <Outlet />;
}
