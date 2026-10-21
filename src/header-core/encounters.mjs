// Maintained shared header logic. The legacy generated module remains a reference.
export class EventManager {
    constructor({dates, names, locations, templates}) {
        Object.assign(this,{dates, names, locations, templates});
    }

    getPartyMeeting(file, campaign) {

        const {templates} = this;
        const {names} = this;
        const {dates} = this;
        const {locations} = this;

        let results = []

        let metadata = file?.frontmatter ?? {}
        let displayData = names.getDisplayData(metadata)
        let pageType = names.getPageType(metadata)

        let format = displayData?.wParty

        function normalizeCampaignInfo(value) {
            if (!value) return []
            if (Array.isArray(value)) return value
            if (typeof value === "object") return [value]
            return []
        }

        for (let element of normalizeCampaignInfo(metadata.campaignInfo).filter(e => e.campaign && e.date)) {

                let displayDate = dates.normalizeDate(element.date)
                if (!displayDate) continue

                let locForThisDate = locations.getWhereabouts(metadata, element.date).current;

                let formatStr = element.wParty ?? element.format ?? format

                if (locForThisDate && (element.campaign == campaign || !campaign)) {
                    let partyPage = names.getCampaignPartyPage(element.campaign)
                    let person = element.person ?? partyPage ?? element.campaign
                    if (person) {
                        let type = element.type ?? "seen"
                        let personName = names.getNameObject(person, pageType)
                        let text = templates.formatDisplayString(formatStr, {frontmatter: metadata, file: ""}, displayDate, {met: type, person: personName, sourcePageType: pageType})
                        results.push({ text: text, campaign: element.campaign, date: displayDate, location: locForThisDate.location })
                    }
                }
        }

        return results
    }
}
