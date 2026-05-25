# Thesis Lab

This directory contains a reproducible demo environment for the thesis experiments:

- `web` namespace business chain
  - `nginx` reverse proxy
  - `frontend`
  - `backend`
  - `db`
  - periodic `cronjob`
  - `attacker` pod
- `flask-ssti` vulnerable target

Files:

- `web-lab.yaml`
  Business chain, cronjob, and attacker pod.
- `flask-ssti-lab.yaml`
  Flask SSTI deployment and service.
- `nginx/Dockerfile`
  Local Nginx image used by the `web` namespace reverse proxy.
- `deploy-thesis-lab.sh`
  Build/import/apply helper for the whole lab.

Defaults:

- Namespace: `web`
- Nginx NodePort: `30080`
- Frontend NodePort: `30081`
- Backend NodePort: `30082`
- Flask SSTI NodePort: `30083`

Useful commands after deployment:

```bash
kubectl get pods,svc,cronjob -n web -o wide
kubectl get pods,svc -n web -l app=flask-ssti -o wide
kubectl exec -n web deploy/attacker -- python /lab/attack.py
```
