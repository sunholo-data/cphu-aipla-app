# Artifact Registry Docker repo. Mirrors ensure_artifact_registry().
resource "google_artifact_registry_repository" "cphu" {
  project       = var.project_id
  location      = var.region
  repository_id = var.ar_repo
  format        = "DOCKER"
  description   = "AIPLA container images"

  depends_on = [google_project_service.apis]
}
