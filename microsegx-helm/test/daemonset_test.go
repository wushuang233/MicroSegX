package test

import (
	"testing"

	"github.com/gruntwork-io/terratest/modules/helm"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
)

func TestEnforcerDaemonset(t *testing.T) {
	helmChartPath := "../charts/core"

	options := &helm.Options{
		SetValues: map[string]string{},
	}

	out := helm.RenderTemplate(t, options, helmChartPath, nvRel, []string{"templates/enforcer-daemonset.yaml"})
	outs := splitYaml(out)

	if len(outs) != 1 {
		t.Errorf("Resource count is wrong. count=%v\n", len(outs))
	}

	var ds appsv1.DaemonSet
	helm.UnmarshalK8SYaml(t, outs[0], &ds)
	if ds.Spec.Template.Spec.HostNetwork {
		t.Errorf("enforcer hostNetwork should be disabled by default\n")
	}
	if ds.Spec.Template.Spec.DNSPolicy != corev1.DNSClusterFirst {
		t.Errorf("enforcer dnsPolicy is wrong. dnsPolicy=%v\n", ds.Spec.Template.Spec.DNSPolicy)
	}

	var bindSource, advertiseSource string
	for _, env := range ds.Spec.Template.Spec.Containers[0].Env {
		if env.Name == "CLUSTER_BIND_ADDR" && env.ValueFrom != nil && env.ValueFrom.FieldRef != nil {
			bindSource = env.ValueFrom.FieldRef.FieldPath
		}
		if env.Name == "CLUSTER_ADVERTISED_ADDR" && env.ValueFrom != nil && env.ValueFrom.FieldRef != nil {
			advertiseSource = env.ValueFrom.FieldRef.FieldPath
		}
	}
	if bindSource != "status.podIP" {
		t.Errorf("CLUSTER_BIND_ADDR should use podIP by default. fieldPath=%v\n", bindSource)
	}
	if advertiseSource != "status.podIP" {
		t.Errorf("CLUSTER_ADVERTISED_ADDR should use podIP by default. fieldPath=%v\n", advertiseSource)
	}
}

func TestEnforcerDaemonsetHostNetwork(t *testing.T) {
	helmChartPath := "../charts/core"

	options := &helm.Options{
		SetValues: map[string]string{
			"enforcer.hostNetwork": "true",
		},
	}

	out := helm.RenderTemplate(t, options, helmChartPath, nvRel, []string{"templates/enforcer-daemonset.yaml"})
	outs := splitYaml(out)

	if len(outs) != 1 {
		t.Errorf("Resource count is wrong. count=%v\n", len(outs))
	}

	var ds appsv1.DaemonSet
	helm.UnmarshalK8SYaml(t, outs[0], &ds)
	if !ds.Spec.Template.Spec.HostNetwork {
		t.Errorf("enforcer hostNetwork should be enabled\n")
	}
	if ds.Spec.Template.Spec.DNSPolicy != corev1.DNSClusterFirstWithHostNet {
		t.Errorf("enforcer dnsPolicy is wrong. dnsPolicy=%v\n", ds.Spec.Template.Spec.DNSPolicy)
	}

	var bindSource, advertiseSource string
	for _, env := range ds.Spec.Template.Spec.Containers[0].Env {
		if env.Name == "CLUSTER_BIND_ADDR" && env.ValueFrom != nil && env.ValueFrom.FieldRef != nil {
			bindSource = env.ValueFrom.FieldRef.FieldPath
		}
		if env.Name == "CLUSTER_ADVERTISED_ADDR" && env.ValueFrom != nil && env.ValueFrom.FieldRef != nil {
			advertiseSource = env.ValueFrom.FieldRef.FieldPath
		}
	}
	if bindSource != "status.hostIP" {
		t.Errorf("CLUSTER_BIND_ADDR should use hostIP in hostNetwork mode. fieldPath=%v\n", bindSource)
	}
	if advertiseSource != "status.hostIP" {
		t.Errorf("CLUSTER_ADVERTISED_ADDR should use hostIP in hostNetwork mode. fieldPath=%v\n", advertiseSource)
	}
}

func TestEnforcerDaemonsetPost53(t *testing.T) {
	helmChartPath := "../charts/core"

	options := &helm.Options{
		SetValues: map[string]string{
			"tag": "latest",
		},
	}

	out := helm.RenderTemplate(t, options, helmChartPath, nvRel, []string{"templates/enforcer-daemonset.yaml"})
	outs := splitYaml(out)

	if len(outs) != 1 {
		t.Errorf("Resource count is wrong. count=%v\n", len(outs))
	}

	var ds appsv1.DaemonSet
	helm.UnmarshalK8SYaml(t, outs[0], &ds)
	if ds.Spec.Template.Spec.Containers[0].VolumeMounts[0].Name != "modules-vol" {
		t.Errorf("VolumeMounts[0] is wrong, %v\n", ds.Spec.Template.Spec.Containers[0].VolumeMounts[0])
	}
}

func TestEnforcerDaemonsetRuntimePre53(t *testing.T) {
	helmChartPath := "../charts/core"

	options := &helm.Options{
		SetValues: map[string]string{
			"tag":          "5.2.0",
			"crio.enabled": "true",
			"crio.path":    "/var/run/crio.sock",
		},
	}

	out := helm.RenderTemplate(t, options, helmChartPath, nvRel, []string{"templates/enforcer-daemonset.yaml"})
	outs := splitYaml(out)

	if len(outs) != 1 {
		t.Errorf("Resource count is wrong. count=%v\n", len(outs))
	}

	var ds appsv1.DaemonSet
	helm.UnmarshalK8SYaml(t, outs[0], &ds)

	var found bool
	for _, m := range ds.Spec.Template.Spec.Containers[0].VolumeMounts {
		if m.Name == "runtime-sock" && m.MountPath == "/var/run/crio/crio.sock" {
			found = true
		}
	}
	if !found {
		t.Errorf("Volume mount for the runtime socket is not found. Mounts=%+v\n",
			ds.Spec.Template.Spec.Containers[0].VolumeMounts)
	}

	for _, v := range ds.Spec.Template.Spec.Volumes {
		if v.Name == "runtime-sock" && v.HostPath.Path == "/var/run/crio.sock" {
			found = true
		}
	}
	if !found {
		t.Errorf("Volume for the runtime socket is not found. Volumes=%+v\n",
			ds.Spec.Template.Spec.Volumes)
	}
}

func TestEnforcerDaemonsetRuntimePost53Default(t *testing.T) {
	helmChartPath := "../charts/core"

	options := &helm.Options{
		SetValues: map[string]string{
			"tag":          "5.3.0-s1",
			"crio.enabled": "true",
		},
	}

	out := helm.RenderTemplate(t, options, helmChartPath, nvRel, []string{"templates/enforcer-daemonset.yaml"})
	outs := splitYaml(out)

	if len(outs) != 1 {
		t.Errorf("Resource count is wrong. count=%v\n", len(outs))
	}

	var ds appsv1.DaemonSet
	helm.UnmarshalK8SYaml(t, outs[0], &ds)

	if ds.Spec.Template.Spec.Containers[0].VolumeMounts[0].Name != "modules-vol" {
		t.Errorf("VolumeMounts[0] is wrong, %v\n", ds.Spec.Template.Spec.Containers[0].VolumeMounts[0])
	}
}

func TestEnforcerDaemonsetRuntimePost53NonDefaultLegacy(t *testing.T) {
	helmChartPath := "../charts/core"

	options := &helm.Options{
		SetValues: map[string]string{
			"tag":          "5.3.0",
			"crio.enabled": "true",
			"crio.path":    "/var/run/crio.sock",
		},
	}

	out := helm.RenderTemplate(t, options, helmChartPath, nvRel, []string{"templates/enforcer-daemonset.yaml"})
	outs := splitYaml(out)

	if len(outs) != 1 {
		t.Errorf("Resource count is wrong. count=%v\n", len(outs))
	}

	var ds appsv1.DaemonSet
	helm.UnmarshalK8SYaml(t, outs[0], &ds)

	if ds.Spec.Template.Spec.Containers[0].VolumeMounts[0].Name != "runtime-sock" {
		t.Errorf("VolumeMounts[0] is wrong, %v\n", ds.Spec.Template.Spec.Containers[0].VolumeMounts[0])
	}
}

func TestEnforcerDaemonsetRuntimePost53NonDefault(t *testing.T) {
	helmChartPath := "../charts/core"

	options := &helm.Options{
		SetValues: map[string]string{
			"tag":         "5.3.0",
			"runtimePath": "/var/run/crio/crio.sock",
		},
	}

	out := helm.RenderTemplate(t, options, helmChartPath, nvRel, []string{"templates/enforcer-daemonset.yaml"})
	outs := splitYaml(out)

	if len(outs) != 1 {
		t.Errorf("Resource count is wrong. count=%v\n", len(outs))
	}

	var ds appsv1.DaemonSet
	helm.UnmarshalK8SYaml(t, outs[0], &ds)

	if ds.Spec.Template.Spec.Containers[0].VolumeMounts[0].Name != "runtime-sock" {
		t.Errorf("VolumeMounts[0] is wrong, %v\n", ds.Spec.Template.Spec.Containers[0].VolumeMounts[0])
	}
	if ds.Spec.Template.Spec.Volumes[0].HostPath.Path != "/var/run/crio/crio.sock" {
		t.Errorf("Volume[0] is wrong, %v\n", ds.Spec.Template.Spec.Volumes[0])
	}
}

func TestEnforcerDaemonsetLeastPrivilege(t *testing.T) {
	helmChartPath := "../charts/core"

	options := &helm.Options{
		SetValues: map[string]string{
			"leastPrivilege": "true",
		},
	}

	out := helm.RenderTemplate(t, options, helmChartPath, nvRel, []string{"templates/enforcer-daemonset.yaml"})
	outs := splitYaml(out)

	if len(outs) != 1 {
		t.Errorf("Resource count is wrong. count=%v\n", len(outs))
	}

	for i, output := range outs {
		var dep appsv1.Deployment
		helm.UnmarshalK8SYaml(t, output, &dep)

		switch i {
		case 0:
			if dep.Spec.Template.Spec.ServiceAccountName != "enforcer" {
				t.Errorf("Incorrect service account. sa=%+v\n", dep.Spec.Template.Spec.ServiceAccountName)
			}
		}
	}
}
