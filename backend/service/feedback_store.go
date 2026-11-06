package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/AnTengye/contractdiff/backend/model"
	_ "modernc.org/sqlite"
)

var ErrFeedbackNotFound = errors.New("feedback not found")
var ErrFeedbackConflict = errors.New("feedback changed; reload before updating")

type FeedbackStore struct{ db *sql.DB }

func NewFeedbackStore(path string) (*FeedbackStore, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return nil, err
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY,tenant TEXT NOT NULL,reporter TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS feedback_tenant ON feedback(tenant,created_at);
CREATE TABLE IF NOT EXISTS feedback_events (case_id TEXT NOT NULL,body TEXT NOT NULL);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	if path != ":memory:" {
		if err = os.Chmod(path, 0600); err != nil {
			db.Close()
			return nil, err
		}
	}
	return &FeedbackStore{db: db}, nil
}

func (s *FeedbackStore) Close() error { return s.db.Close() }

// Storage JSON includes object keys; public JSON deliberately does not.
type feedbackRecord struct {
	Case        *model.Feedback   `json:"case"`
	SnapshotKey string            `json:"snapshot_key"`
	Files       map[string]string `json:"files"`
}

func encodeFeedback(f *model.Feedback) ([]byte, error) {
	copy := *f
	copy.Events = nil
	return json.Marshal(feedbackRecord{Case: &copy, SnapshotKey: f.SnapshotKey, Files: f.Files})
}

func (s *FeedbackStore) Create(f *model.Feedback) error {
	f.Revision = 1
	f.Status = "new"
	f.CreatedAt = time.Now().UTC()
	f.UpdatedAt = f.CreatedAt
	body, err := encodeFeedback(f)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`INSERT INTO feedback VALUES (?,?,?,?,?,?,?)`, f.ID, f.Tenant, f.Reporter, f.Status, f.Revision, string(body), f.CreatedAt.Format(time.RFC3339Nano)); err != nil {
		return err
	}
	event, _ := json.Marshal(model.FeedbackEvent{Actor: f.Reporter, Status: "new", Note: "反馈已归档", CreatedAt: f.CreatedAt})
	if _, err = tx.Exec(`INSERT INTO feedback_events VALUES (?,?)`, f.ID, string(event)); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *FeedbackStore) Get(tenant, id string) (*model.Feedback, error) {
	var body string
	if err := s.db.QueryRow(`SELECT body FROM feedback WHERE tenant=? AND id=?`, tenant, id).Scan(&body); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrFeedbackNotFound
		}
		return nil, err
	}
	var record feedbackRecord
	if err := json.Unmarshal([]byte(body), &record); err != nil {
		return nil, err
	}
	f := record.Case
	f.SnapshotKey = record.SnapshotKey
	f.Files = record.Files
	rows, err := s.db.Query(`SELECT body FROM feedback_events WHERE case_id=? ORDER BY rowid`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var text string
		if err = rows.Scan(&text); err != nil {
			return nil, err
		}
		var e model.FeedbackEvent
		if err = json.Unmarshal([]byte(text), &e); err != nil {
			return nil, err
		}
		f.Events = append(f.Events, e)
	}
	return f, rows.Err()
}

func (s *FeedbackStore) List(tenant, reporter string) ([]model.Feedback, error) {
	query := `SELECT id FROM feedback WHERE tenant=?`
	args := []interface{}{tenant}
	if reporter != "" {
		query += ` AND reporter=?`
		args = append(args, reporter)
	}
	query += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	out := []model.Feedback{}
	for _, id := range ids {
		f, err := s.Get(tenant, id)
		if err != nil {
			return nil, err
		}
		f.Events = nil
		out = append(out, *f)
	}
	return out, nil
}

func (s *FeedbackStore) Update(f *model.Feedback, actor, note string, revision int) error {
	f.Revision = revision + 1
	f.UpdatedAt = time.Now().UTC()
	body, err := encodeFeedback(f)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE feedback SET status=?,revision=?,body=? WHERE tenant=? AND id=? AND revision=?`, f.Status, f.Revision, string(body), f.Tenant, f.ID, revision)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrFeedbackConflict
	}
	event, err := json.Marshal(model.FeedbackEvent{Actor: actor, Status: f.Status, Note: note, CreatedAt: f.UpdatedAt})
	if err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO feedback_events VALUES (?,?)`, f.ID, string(event)); err != nil {
		return fmt.Errorf("save feedback event: %w", err)
	}
	return tx.Commit()
}
