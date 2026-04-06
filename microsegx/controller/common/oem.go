package common

import (
	"github.com/wushuang233/MicroSegX/microsegx/controller/api"
	"github.com/wushuang233/MicroSegX/microsegx/share"
)

const OEMDefaultUserLocale string = "en"

var OEMClusterSecurityRuleGroup = "microsegx.com"
var OEMSecurityRuleGroup = "microsegx.com"

func OEMPlatformVersionURL() string {
	return ""
}

func OEMIgnoreWorkload(wl *share.CLUSWorkload) bool {
	return false
}

func OEMIgnoreImageRepo(img *share.CLUSImage) bool {
	return false
}

func OEMLicenseValidate(info *api.RESTLicenseInfo) bool {
	return true
}
