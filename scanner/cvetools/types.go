package cvetools

import (
	"github.com/microsegx/microsegx/share/system"
	"github.com/microsegx/microsegx/share/utils"
	"github.com/microsegx/scanner/common"
	"github.com/microsegx/scanner/detectors"
)

/* removd by golint
type updateData struct {
	Redhat  bool
	Debian  bool
	Ubuntu  bool
	Alpine  bool
	Amazon  bool
	Oracle  bool
	Suse    bool
	Mariner bool
}
*/

type ScanTools struct {
	common.CveDB
	RtSock      string
	SupportOs   utils.Set
	sys         *system.SystemTools
	LayerCacher *ImageLayerCacher
	modulesFile string
}

type vulShortReport struct {
	Vs common.VulShort
	Ft detectors.FeatureVersion
}

type vulFullReport struct {
	Vf common.VulFull
	Ft detectors.FeatureVersion
}
