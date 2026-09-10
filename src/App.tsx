import { AuthenticatedTemplate, UnauthenticatedTemplate } from '@azure/msal-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SignInScreen } from './components/SignInScreen';
import { UpdatePrompt } from './components/UpdatePrompt';
import { HomeScreen } from './components/HomeScreen';
import { MapScreen } from './components/MapScreen';
import { NotBuiltYet } from './components/NotBuiltYet';

interface AppProps {
  /** Surfaced from main.tsx if MSAL bootstrap (init / handleRedirectPromise) threw. */
  bootError: string | null;
}

/**
 * Routes are real URLs rather than the phase union used in expenses-app: a
 * study app needs deep links (open one process node from a citation, resume a
 * drill from the review queue) and a working back button.
 */
export default function App({ bootError }: AppProps) {
  return (
    <>
      <UnauthenticatedTemplate>
        <SignInScreen bootError={bootError} />
      </UnauthenticatedTemplate>

      <AuthenticatedTemplate>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/pack/:packId/map" element={<MapScreen />} />
          <Route path="/pack/:packId/map/:nodeId" element={<MapScreen />} />
          <Route
            path="/pack/:packId/walkthrough"
            element={<NotBuiltYet mode="Walkthrough" />}
          />
          <Route
            path="/pack/:packId/drill/:kind"
            element={<NotBuiltYet mode="Drills" />}
          />
          <Route path="/pack/:packId/explain" element={<NotBuiltYet mode="Explain" />} />
          <Route path="/review" element={<NotBuiltYet mode="Review queue" />} />
          <Route path="/ingest" element={<NotBuiltYet mode="Add a source" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthenticatedTemplate>

      <UpdatePrompt />
    </>
  );
}
