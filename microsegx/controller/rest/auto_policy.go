package rest

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/julienschmidt/httprouter"
	log "github.com/sirupsen/logrus"

	"github.com/wushuang233/MicroSegX/microsegx/controller/api"
)

func handlerAutoPolicyStatus(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	log.WithFields(log.Fields{"URL": r.URL.String()}).Debug("")

	acc, login := getAccessControl(w, r, "")
	if acc == nil {
		return
	}

	resp := api.RESTAutoPolicyStatusData{
		Status: cacher.GetAutoPolicyStatus(acc),
	}
	restRespSuccess(w, r, &resp, acc, login, nil, "Get auto policy status")
}

func handlerAutoPolicyConfig(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	log.WithFields(log.Fields{"URL": r.URL.String()}).Debug("")

	acc, login := getAccessControl(w, r, "")
	if acc == nil {
		return
	}

	var req api.RESTAutoPolicyConfigData
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Config == nil || strings.TrimSpace(req.Config.Mode) == "" {
		restRespError(w, http.StatusBadRequest, api.RESTErrInvalidRequest)
		return
	}

	status, err := cacher.SetAutoPolicyMode(req.Config.Mode, acc)
	if err != nil {
		restRespErrorMessage(w, http.StatusBadRequest, api.RESTErrInvalidRequest, err.Error())
		return
	}

	resp := api.RESTAutoPolicyStatusData{
		Status: status,
	}
	restRespSuccess(w, r, &resp, acc, login, nil, "Update auto policy config")
}

func handlerAutoPolicyRuleList(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	log.WithFields(log.Fields{"URL": r.URL.String()}).Debug("")

	acc, login := getAccessControl(w, r, "")
	if acc == nil {
		return
	}

	resp := api.RESTAutoPolicyRulesData{
		Rules: cacher.GetAllAutoPolicyRules(acc),
	}
	restRespSuccess(w, r, &resp, acc, login, nil, "Get auto policy rule list")
}

func handlerAutoPolicyRuleCreate(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	log.WithFields(log.Fields{"URL": r.URL.String()}).Debug("")
	defer r.Body.Close()

	acc, login := getAccessControl(w, r, "")
	if acc == nil {
		return
	}

	var req api.RESTAutoPolicyRuleCreateData
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Config == nil {
		restRespError(w, http.StatusBadRequest, api.RESTErrInvalidRequest)
		return
	}

	rule, err := cacher.CreateAutoPolicyRule(req.Config, acc)
	if err != nil {
		restRespErrorMessage(w, http.StatusBadRequest, api.RESTErrInvalidRequest, err.Error())
		return
	}

	resp := api.RESTAutoPolicyRuleData{
		Rule: rule,
	}
	restRespSuccess(w, r, &resp, acc, login, nil, "Create auto policy rule")
}

func handlerAutoPolicyFeatureList(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	log.WithFields(log.Fields{"URL": r.URL.String()}).Debug("")

	acc, login := getAccessControl(w, r, "")
	if acc == nil {
		return
	}

	resp := api.RESTAutoPolicyFeaturesData{
		Features: cacher.GetAllAutoPolicyFeatures(acc),
	}
	restRespSuccess(w, r, &resp, acc, login, nil, "Get auto policy feature list")
}

func handlerAutoPolicyRuleShow(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	log.WithFields(log.Fields{"URL": r.URL.String()}).Debug("")

	acc, login := getAccessControl(w, r, "")
	if acc == nil {
		return
	}

	id, err := strconv.Atoi(ps.ByName("id"))
	if err != nil || id <= 0 {
		restRespError(w, http.StatusBadRequest, api.RESTErrInvalidRequest)
		return
	}

	rule, err := cacher.GetAutoPolicyRule(uint32(id), acc)
	if err != nil {
		restRespNotFoundLogAccessDenied(w, login, err)
		return
	}

	resp := api.RESTAutoPolicyRuleData{
		Rule: rule,
	}
	restRespSuccess(w, r, &resp, acc, login, nil, "Get auto policy rule")
}

func handlerAutoPolicyRuleUpdate(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	log.WithFields(log.Fields{"URL": r.URL.String()}).Debug("")
	defer r.Body.Close()

	acc, login := getAccessControl(w, r, "")
	if acc == nil {
		return
	}

	id, err := strconv.Atoi(ps.ByName("id"))
	if err != nil || id <= 0 {
		restRespError(w, http.StatusBadRequest, api.RESTErrInvalidRequest)
		return
	}

	var req api.RESTAutoPolicyRuleUpdateData
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Config == nil {
		restRespError(w, http.StatusBadRequest, api.RESTErrInvalidRequest)
		return
	}

	rule, err := cacher.UpdateAutoPolicyRule(uint32(id), req.Config, acc)
	if err != nil {
		restRespErrorMessage(w, http.StatusBadRequest, api.RESTErrInvalidRequest, err.Error())
		return
	}

	resp := api.RESTAutoPolicyRuleData{
		Rule: rule,
	}
	restRespSuccess(w, r, &resp, acc, login, nil, "Update auto policy rule")
}

func handlerAutoPolicyRuleDelete(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	log.WithFields(log.Fields{"URL": r.URL.String()}).Debug("")
	defer r.Body.Close()

	acc, login := getAccessControl(w, r, "")
	if acc == nil {
		return
	}

	id, err := strconv.Atoi(ps.ByName("id"))
	if err != nil || id <= 0 {
		restRespError(w, http.StatusBadRequest, api.RESTErrInvalidRequest)
		return
	}

	result, err := cacher.DeleteAutoPolicyRules([]uint32{uint32(id)}, acc)
	if err != nil {
		restRespNotFoundLogAccessDenied(w, login, err)
		return
	}

	resp := api.RESTAutoPolicyRuleDeleteData{
		Result: result,
	}
	restRespSuccess(w, r, &resp, acc, login, nil, "Delete auto policy rule")
}

func handlerAutoPolicyRuleBulkDelete(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	log.WithFields(log.Fields{"URL": r.URL.String()}).Debug("")
	defer r.Body.Close()

	acc, login := getAccessControl(w, r, "")
	if acc == nil {
		return
	}

	var req api.RESTAutoPolicyRuleDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) == 0 {
		restRespError(w, http.StatusBadRequest, api.RESTErrInvalidRequest)
		return
	}

	result, err := cacher.DeleteAutoPolicyRules(req.IDs, acc)
	if err != nil {
		restRespNotFoundLogAccessDenied(w, login, err)
		return
	}

	resp := api.RESTAutoPolicyRuleDeleteData{
		Result: result,
	}
	restRespSuccess(w, r, &resp, acc, login, nil, "Delete auto policy rules")
}

func handlerAutoPolicyEventList(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	log.WithFields(log.Fields{"URL": r.URL.String()}).Debug("")

	acc, login := getAccessControl(w, r, "")
	if acc == nil {
		return
	}

	resp := api.RESTAutoPolicyEventsData{
		Events: cacher.GetAutoPolicyEvents(acc),
	}
	restRespSuccess(w, r, &resp, acc, login, nil, "Get auto policy event list")
}
