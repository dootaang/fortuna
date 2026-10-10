import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Frame, PageTitle } from "../ui/kit.tsx";

export function RouteError() {
  const error = useRouteError();
  const chunkFailed = error instanceof Error && /dynamically imported module|Loading chunk/i.test(error.message);
  return (
    <main className="mx-auto max-w-md p-6">
      <PageTitle eyebrow="Out of Service" title="선로에 문제가 생겼습니다" />
      <Frame>
        <p className="text-sm">
          {chunkFailed ? "새 버전이 배포되었습니다. 새로고침하면 바로 이어서 하실 수 있습니다." : isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : "잠시 후 다시 시도해 주십시오."}
        </p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn btn-gold" onClick={() => window.location.reload()}>새로고침</button>
          <Link to="/" className="btn btn-ghost">로비로</Link>
        </div>
      </Frame>
    </main>
  );
}
