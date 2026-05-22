import json
import zipfile
from pathlib import Path

EXAM_ZIP = Path(__file__).parent.parent.parent / "exam_data" / "exam.zip"
SECTION_TYPE = {
    "section-1": "vocabulary",
    "section-2": "reading",
    "section-3": "listening",
}
OPTION_MAP = {"1": "A", "2": "B", "3": "C", "4": "D"}


def seed_exam_data(db) -> int:
    """Import all exam sets and questions from exam.zip. Returns count of newly added questions."""
    from app.jlpt.models import JlptExamSet, Question

    if not EXAM_ZIP.exists():
        return 0

    added = 0
    with zipfile.ZipFile(EXAM_ZIP) as zf:
        names = set(zf.namelist())
        exam_dirs = sorted({
            n.split("/")[1]
            for n in names
            if n.startswith("exam/") and n.count("/") >= 2
        })

        for exam_id in exam_dirs:
            parts = exam_id.split("-")  # ["N1", "2025", "12"]
            if len(parts) != 3:
                continue
            level, year = parts[0], int(parts[1])
            session = "december" if parts[2] == "12" else "july"

            exam_set = db.query(JlptExamSet).filter_by(
                level=level, year=year, session=session
            ).first()
            if not exam_set:
                exam_set = JlptExamSet(
                    name=f"JLPT {level} {year}/{parts[2]}",
                    level=level,
                    year=year,
                    session=session,
                    description=f"Đề thi chính thức JLPT {level} tháng {parts[2]}/{year}",
                    is_active=True,
                )
                db.add(exam_set)
                db.flush()

            existing_sources = {
                row[0]
                for row in db.query(Question.source_url).filter_by(exam_set_id=exam_set.id).all()
            }

            for sec_name, q_type in SECTION_TYPE.items():
                path = f"exam/{exam_id}/{sec_name}.json"
                if path not in names:
                    continue
                data = json.loads(zf.read(path))
                passages = {p["pid"]: p["passage"] for p in data.get("passages", [])}

                for sec in data.get("sections", []):
                    for q in sec.get("questions", []):
                        uid = f"{exam_id}/{sec_name}/q{q['qid']}"
                        if uid in existing_sources:
                            continue
                        opts = q["options"]
                        raw_answer = str(q.get("answer", "1"))
                        correct = OPTION_MAP.get(raw_answer, "A")
                        pid = q.get("pid")
                        if isinstance(pid, list):
                            passage_text = "\n\n".join(
                                passages[p] for p in pid if p in passages
                            ) or None
                        else:
                            passage_text = passages.get(pid) if pid is not None else None
                        db.add(Question(
                            level=level,
                            question_type=q_type,
                            exam_set_id=exam_set.id,
                            question_text=q["ques"],
                            option_a=opts.get("1", ""),
                            option_b=opts.get("2", ""),
                            option_c=opts.get("3", ""),
                            option_d=opts.get("4", ""),
                            correct_answer=correct,
                            explanation=q.get("expl"),
                            passage=passage_text,
                            source_url=uid,
                            is_active=True,
                        ))
                        added += 1

    db.commit()
    return added
