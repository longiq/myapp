"""Smoke tests — verify the app starts and core routes respond correctly."""


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_docs_available(client):
    r = client.get("/api/docs")
    assert r.status_code == 200


# ── Auth ──────────────────────────────────────────────────────────────────────


def test_register_and_login(client):
    payload = {"username": "testuser", "email": "test@example.com", "password": "password123"}
    r = client.post("/api/v1/auth/register", json=payload)
    assert r.status_code == 201
    data = r.json()
    assert data["username"] == "testuser"
    assert "has_jlpt_exam_access" in data

    r = client.post("/api/v1/auth/login", json={"username": "testuser", "password": "password123"})
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_login_wrong_password(client):
    r = client.post("/api/v1/auth/login", json={"username": "testuser", "password": "wrong"})
    assert r.status_code == 401


def test_me_requires_auth(client):
    r = client.get("/api/v1/auth/me")
    assert r.status_code in (401, 403)


def test_me_with_token(client):
    r = client.post("/api/v1/auth/login", json={"username": "testuser", "password": "password123"})
    token = r.json()["access_token"]
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["username"] == "testuser"


# ── JLPT public endpoints ──────────────────────────────────────────────────────


def test_question_stats(client):
    r = client.get("/api/v1/jlpt/questions/stats/summary")
    assert r.status_code == 200
    data = r.json()
    assert "total" in data


def test_question_list(client):
    r = client.get("/api/v1/jlpt/questions/")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ── JLPT auth-protected endpoints ─────────────────────────────────────────────


def test_quiz_start_requires_auth(client):
    r = client.post("/api/v1/jlpt/quiz/start", json={"level": "N5"})
    assert r.status_code in (401, 403)


def test_quiz_history_requires_auth(client):
    r = client.get("/api/v1/jlpt/quiz/history")
    assert r.status_code in (401, 403)


def test_exam_sets_requires_auth(client):
    r = client.get("/api/v1/jlpt/quiz/exam-sets")
    assert r.status_code in (401, 403)


# ── Admin endpoints ────────────────────────────────────────────────────────────


def test_admin_users_requires_superuser(client):
    r = client.post("/api/v1/auth/login", json={"username": "testuser", "password": "password123"})
    token = r.json()["access_token"]
    r = client.get("/api/v1/admin/users", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_admin_exam_sets_requires_superuser(client):
    r = client.post("/api/v1/auth/login", json={"username": "testuser", "password": "password123"})
    token = r.json()["access_token"]
    r = client.get("/api/v1/admin/exam-sets", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_exam_access_denied_without_permission(client):
    r = client.post("/api/v1/auth/login", json={"username": "testuser", "password": "password123"})
    token = r.json()["access_token"]
    r = client.get("/api/v1/jlpt/quiz/exam-sets", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
