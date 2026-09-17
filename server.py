"""
요리 일기 - 로컬 서버

역할 1: 앱 파일(index.html 등)을 브라우저에 보여줌 (python -m http.server와 같음)
역할 2: /api/video?url=...  → 유튜브 영상의 제목, 설명(소개란), 인기 댓글을 읽어서 돌려줌
        (브라우저는 유튜브를 직접 읽을 수 없어서 이 서버가 대신 읽어줌. 돈 안 듦, 키 필요 없음)

실행:  python server.py
"""
import itertools
import json
import re
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 5173
HERE = Path(__file__).parent


# ----- 유튜브에서 제목·설명·댓글 가져오기 -----
def youtube_id(url):
    m = re.search(r"(?:youtu\.be/|v=|shorts/|embed/)([\w-]{11})", url or "")
    return m.group(1) if m else None


def fetch_page_info(video_id):
    """영상 페이지에서 제목과 설명(더보기 내용)을 뽑음. 설명에 재료가 적혀 있는 경우가 많음."""
    req = urllib.request.Request(
        f"https://www.youtube.com/watch?v={video_id}&hl=ko",
        headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "ko,en"},
    )
    html = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", "ignore")
    title = re.search(r'"title":"((?:[^"\\]|\\.)*)"', html)
    desc = re.search(r'"shortDescription":"((?:[^"\\]|\\.)*)"', html)
    unescape = lambda s: json.loads(f'"{s}"') if s else ""
    return unescape(title.group(1) if title else ""), unescape(desc.group(1) if desc else "")


def fetch_comments(video_id, limit=30):
    """인기순 댓글. 레시피를 댓글에 적어두는 경우(고정 댓글 등)를 위해."""
    try:
        from youtube_comment_downloader import YoutubeCommentDownloader, SORT_BY_POPULAR
        gen = YoutubeCommentDownloader().get_comments_from_url(
            f"https://www.youtube.com/watch?v={video_id}", sort_by=SORT_BY_POPULAR
        )
        return [
            {"author": c.get("author", ""), "text": c.get("text", ""), "heart": bool(c.get("heart")), "votes": c.get("votes", "")}
            for c in itertools.islice(gen, limit)
        ]
    except Exception:
        return []


def fetch_meta(url):
    """아무 링크(블로그, 인스타, 쇼츠 등)에서 제목 뽑기. 유튜브는 전용 함수 사용."""
    vid = youtube_id(url)
    if vid:
        title, _ = fetch_page_info(vid)
        return title
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36", "Accept-Language": "ko,en"}
    )
    html = urllib.request.urlopen(req, timeout=10).read(300_000).decode("utf-8", "ignore")
    m = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)', html, re.I) \
        or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title["\']', html, re.I) \
        or re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
    import html as html_lib
    title = html_lib.unescape(m.group(1)).strip() if m else ""
    # "Instagram", "네이버 블로그" 같은 사이트 이름만 있는 제목은 도움이 안 되므로 비움
    if title.lower() in ("instagram", "youtube", "네이버 블로그", "tiktok"):
        title = ""
    return title


# ----- 웹 서버 -----
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE), **kw)

    def log_message(self, fmt, *args):  # 파일 요청은 조용히, /api/ 요청만 출력
        if "/api/" in str(args[0] if args else ""):
            super().log_message(fmt, *args)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/status":
            return self.send_json({"video": True})
        if parsed.path == "/api/meta":
            url = urllib.parse.parse_qs(parsed.query).get("url", [""])[0]
            try:
                return self.send_json({"title": fetch_meta(url)})
            except Exception:
                return self.send_json({"title": ""})  # 제목을 못 가져와도 저장은 되게
        if parsed.path == "/api/video":
            url = urllib.parse.parse_qs(parsed.query).get("url", [""])[0]
            vid = youtube_id(url)
            if not vid:
                return self.send_json({"error": "유튜브 링크가 아니에요."}, 400)
            try:
                title, desc = fetch_page_info(vid)
                comments = fetch_comments(vid)
                return self.send_json({"title": title, "description": desc, "comments": comments})
            except Exception as e:  # 어떤 문제든 화면에 이유를 보여줌
                return self.send_json({"error": f"영상을 읽지 못했어요: {type(e).__name__}: {e}"}, 500)
        super().do_GET()


if __name__ == "__main__":
    print(f"요리 일기 실행 중 → http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
