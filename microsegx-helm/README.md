# MicroSegX Helm charts

A collection of Helm charts for deploying MicroSegX product in Kubernetes, Rancher and Openshift clusters.

## Installing charts

### Helm Charts

This repository contains three Helm charts.
Chart | Description
----- | -----------
core | Deploy MicroSegX container security core services. [chart](charts/core)
crd | Deploy CRD services before installing MicroSegX container security platform. [chart](charts/crd)
monitor | Deploy monitoring services, such as Prometheus exporter. [chart](charts/monitor)

**IMPORTANT** - Each chart has a set of configuration values, especially for the 'core' chart. Review the Helm chart configuration values [here](charts/core) and make any required changes to the `values.yaml` file for your deployment.

### Adding chart repo

```console
helm repo add microsegx https://microsegx.github.io/microsegx-helm/
helm search repo microsegx/core
```

### Versioning

Helm charts for officially released product are published from the release branch of the repository. The main branch is used for the charts of the product in the development. Typically, the charts in the main branch are published with the alpha, beta or rc tag. They can be discovered with --devel option.

```console
$ helm search repo microsegx/core -l
NAME          	CHART VERSION	APP VERSION	DESCRIPTION
microsegx/core	2.2.2       	5.0.2      	Helm chart for MicroSegX's core services
microsegx/core	2.2.1        	5.0.1      	Helm chart for MicroSegX's core services
microsegx/core	2.2.0        	5.0.0      	Helm chart for MicroSegX's core services
microsegx/core	1.9.2        	4.4.4-s2   	Helm chart for MicroSegX's core services
microsegx/core	1.9.1        	4.4.4      	Helm chart for MicroSegX's core services
...
...

$ helm search repo microsegx/core --devel
NAME            	CHART VERSION	APP VERSION	DESCRIPTION
microsegx/core	2.2.0-b1     	5.0.0-b1   	Helm chart for MicroSegX's core services
microsegx/core	1.9.2        	4.4.4-s2   	Helm chart for MicroSegX's core services
microsegx/core	1.9.1        	4.4.4      	Helm chart for MicroSegX's core services
microsegx/core	1.9.0        	4.4.4      	Helm chart for MicroSegX's core services
microsegx/core	1.8.9        	4.4.3      	Helm chart for MicroSegX's core services
...
...
```

### Deploy in Kubernetes

To install the chart with the release name `microsegx`:

- Create the MicroSegX namespace. You can use namespace name other than "microsegx".
```console
kubectl create namespace microsegx
```

- Label the MicroSegX namespace with privileged profile for deploying on PSA enabled cluster.
```console
kubectl label  namespace microsegx "pod-security.kubernetes.io/enforce=privileged"
```

- To install the chart with the release name `microsegx`.
```console
helm install microsegx --namespace microsegx --create-namespace microsegx/core
```

You can find a list of all config options in the [README of the core chart](charts/core).

### Deploy in Rancher by SUSE


You can find instructions for deploying MicroSegX from Rancher charts here: https://open-docs.microsegx.com/deploying/rancher


### Deploy in RedHat OpenShift

- Create a new project.
```console
oc new-project microsegx
```

- Privileged SCC is added to Service Account specified in the values.yaml by Helm chart version 2.0.0 and above in new Helm install on OpenShift 4.x. In case of upgrading MicroSegX chart from previous version to 2.0.0, please delete Privileged SCC before upgrading.

```console
oc delete rolebinding -n microsegx system:openshift:scc:privileged
```

To install the chart with the release name `microsegx`:

```console
helm install microsegx --namespace microsegx microsegx/core --set openshift=true,crio.enabled=true
```

## Rolling upgrade

```console
helm upgrade microsegx --set tag=5.0.2 microsegx/core
```

## Uninstalling the Chart

To uninstall/delete the `microsegx` deployment:

```console
helm delete microsegx
```

The command removes all the Kubernetes components associated with the chart and deletes the release.

## Using private registry

If you are using a private registry, you need pull MicroSegX images of the specified version to your own registry and add registry name when installing the chart.

```console
helm install microsegx --namespace microsegx microsegx/core --set registry=your-private-registry
```

If your registry needs authentication, create a secret with the authentication information:

```console
kubectl create secret docker-registry regsecret -n microsegx --docker-server=https://your-private-registry/ --docker-username=your-name --docker-password=your-password --docker-email=your-email
```

or for OpenShift:

```console
oc create secret docker-registry regsecret -n microsegx --docker-server=https://your-private-registry/ --docker-username=your-name --docker-password=your-password --docker-email=your-email
```

And install the helm chart with at least these values:

```console
helm install microsegx --namespace microsegx microsegx/core --set imagePullSecrets=regsecret,registry=your-private-registry
```

To keep the vulnerability database up-to-date, you want to create a script, run it as a cronjob to pull the updater and scanner images periodically to your own registry.

```console
$ docker login docker.io
$ docker pull docker.io/microsegx/updater
$ docker logout docker.io

$ oc login -u <user_name>
# this user_name is the one when you install microsegx

$ docker login -u <user_name> -p `oc whoami -t` docker-registry.default.svc:5000
$ docker tag docker.io/microsegx/updater docker-registry.default.svc:5000/microsegx/updater
$ docker push docker-registry.default.svc:5000/microsegx/updater
$ docker logout docker-registry.default.svc:5000
```

## Migration

If you are using the previous way to install charts from the source directly, after adding the Helm repo, you can upgrade the current installation by given the same chart name. 

```console
helm upgrade my-release microsegx/core --namespace microsegx --set tag=4.1.0
```
