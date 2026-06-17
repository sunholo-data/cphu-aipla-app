# Firestore Native database. Mirrors ensure_firestore().
# Pinned to the compute region (europe-north1, Finland — ADR-007).
resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.apis]
}
