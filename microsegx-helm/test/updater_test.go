package test

import (
	"strings"
	"testing"

	"github.com/gruntwork-io/terratest/modules/helm"
	batv1beta1 "k8s.io/api/batch/v1beta1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
)

func TestUpdater(t *testing.T) {
	helmChartPath := "../charts/core"

	options := &helm.Options{
		SetValues: map[string]string{
			"cve.updater.enabled": "true",
			"cve.scanner.enabled": "false",
		},
	}

	// Test ingress
	out := helm.RenderTemplate(t, options, helmChartPath, nvRel, []string{"templates/updater-cronjob.yaml"})
	outs := splitYaml(out)

	if len(outs) != 1 {
		t.Errorf("Resource count is wrong. count=%v\n", len(outs))
	}

	for i, output := range outs {
		var job batv1beta1.CronJob
		helm.UnmarshalK8SYaml(t, output, &job)

		switch i {
		case 0:
			if job.Name != "microsegx-updater-pod" {
				t.Errorf("Incorrect cronjob name. name=%v\n", job.Name)
			}
			if job.Spec.JobTemplate.Spec.Template.Spec.ServiceAccountName != "updater" {
				t.Errorf("Incorrect service account. sa=%v\n", job.Spec.JobTemplate.Spec.Template.Spec.ServiceAccountName)
			}
			if strings.HasPrefix(job.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Image, "/") {
				t.Errorf("Updater image must not start with '/'. image=%v\n", job.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Image)
			}
			if job.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Lifecycle != nil {
				t.Errorf("No need to update scanner.\n")
			}
		}
	}
}

func TestUpdaterWithScanner(t *testing.T) {
	helmChartPath := "../charts/core"

	options := &helm.Options{
		SetValues: map[string]string{
			"cve.updater.enabled": "true",
			"cve.scanner.enabled": "true",
		},
	}

	// Test ingress
	out := helm.RenderTemplate(t, options, helmChartPath, nvRel, []string{"templates/updater-cronjob.yaml"})
	outs := splitYaml(out)

	if len(outs) != 1 {
		t.Errorf("Resource count is wrong. count=%v\n", len(outs))
	}

	for i, output := range outs {
		var job batv1beta1.CronJob
		helm.UnmarshalK8SYaml(t, output, &job)

		switch i {
		case 0:
			if job.Name != "microsegx-updater-pod" {
				t.Errorf("Incorrect cronjob name. name=%v\n", job.Name)
			}
			if job.Spec.JobTemplate.Spec.Template.Spec.ServiceAccountName != "updater" {
				t.Errorf("Incorrect service account. sa=%v\n", job.Spec.JobTemplate.Spec.Template.Spec.ServiceAccountName)
			}
			if strings.HasPrefix(job.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Image, "/") {
				t.Errorf("Updater image must not start with '/'. image=%v\n", job.Spec.JobTemplate.Spec.Template.Spec.Containers[0].Image)
			}
		}
	}
}

func TestUpdaterRBAC(t *testing.T) {
	helmChartPath := "../charts/core"

	options := &helm.Options{
		SetValues: map[string]string{
			"cve.updater.enabled": "true",
		},
	}

	out := helm.RenderTemplate(t, options, helmChartPath, nvRel, []string{"templates/updater-rbac.yaml"})
	outs := splitYaml(out)

	if len(outs) != 3 {
		t.Errorf("Resource count is wrong. count=%v\n", len(outs))
	}

	var sa corev1.ServiceAccount
	helm.UnmarshalK8SYaml(t, outs[0], &sa)
	if sa.Name != "updater" {
		t.Errorf("Incorrect service account name. name=%v\n", sa.Name)
	}

	var role rbacv1.Role
	helm.UnmarshalK8SYaml(t, outs[1], &role)
	if role.Name != "microsegx-updater" {
		t.Errorf("Incorrect role name. name=%v\n", role.Name)
	}
	if len(role.Rules) != 1 || len(role.Rules[0].ResourceNames) != 1 || role.Rules[0].ResourceNames[0] != "microsegx-scanner-pod" {
		t.Errorf("Incorrect updater role rules. rules=%+v\n", role.Rules)
	}

	var rb rbacv1.RoleBinding
	helm.UnmarshalK8SYaml(t, outs[2], &rb)
	if rb.Name != "microsegx-updater" {
		t.Errorf("Incorrect rolebinding name. name=%v\n", rb.Name)
	}
	if len(rb.Subjects) != 1 || rb.Subjects[0].Name != "updater" {
		t.Errorf("Incorrect rolebinding subject. subjects=%+v\n", rb.Subjects)
	}
}
