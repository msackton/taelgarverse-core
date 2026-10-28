class DateManager {

    DR_MONTHS = {
        1: 'January',
        2: 'February',
        3: 'March',
        4: 'April',
        5: 'May',
        6: 'June',
        7: 'July',
        8: 'August',
        9: 'September',
        10: 'October',
        11: 'November',
        12: 'December'
    }

    #getNameForMonth(month) {
        return this.DR_MONTHS[month]
    }

    setPageDateProperties(pageDates, targetDate) {

        if (pageDates.startDate) {
            pageDates.isCreated = pageDates.startDate.sort <= targetDate.sort;
        } else {
            pageDates.isCreated = true
        }

        if (pageDates.endDate) {
            pageDates.isAlive = pageDates.endDate.sort >= targetDate.sort;
        } else {
            pageDates.isAlive = pageDates.isCreated
        }

        if (pageDates.startDate) {
            if (pageDates.isAlive) {
                pageDates.age = targetDate.days - pageDates.startDate.days
            }
            else if (pageDates.endDate) {
                pageDates.age = pageDates.endDate.days - pageDates.startDate.days
            }
        }
    }

    #getPageDateSource(metadata) {
        const frontmatter = metadata?.file?.frontmatter
        if (!frontmatter) return metadata ?? {}

        const pageDateKeys = ["born", "died", "created", "destroyed", "DR", "DR_end", "pageTargetDate"]
        const hasPageDateFrontmatter = pageDateKeys.some(key => Object.prototype.hasOwnProperty.call(frontmatter, key))

        return hasPageDateFrontmatter ? frontmatter : (metadata ?? frontmatter)
    }

    getPageDates(metadata, targetDate) {

        let dateMetadata = this.#getPageDateSource(metadata)

        if (!targetDate) targetDate = this.getTargetDateForPage(dateMetadata)

        let status = {
            startDate: undefined,
            endDate: undefined,
            isCreated: undefined,
            isAlive: undefined,
            age: undefined
        }

        let useDR = true;
        if ("born" in dateMetadata || "died" in dateMetadata || "created" in dateMetadata || "destroyed" in dateMetadata) {
            useDR = false;
        }

        // Determine page type (when available) to avoid misclassifying non-events as ended when only DR is present
        let pageType = "unknown";
        try {
            const { NameManager } = customJS;
            pageType = NameManager.getPageType(dateMetadata) ?? "unknown";
        } catch (e) {
            // If NameManager isn't available in this context, fall back to generic behavior
        }

        if (dateMetadata.born) {
            status.startDate = this.normalizeDate(dateMetadata.born, false);
        } else if (dateMetadata.created) {
            status.startDate = this.normalizeDate(dateMetadata.created, false);
        } else if (dateMetadata.DR && useDR) {
            status.startDate = this.normalizeDate(dateMetadata.DR, false);
        }

        if (dateMetadata.died) {
            status.endDate = this.normalizeDate(dateMetadata.died, true);
        } else if (dateMetadata.destroyed) {
            status.endDate = this.normalizeDate(dateMetadata.destroyed, true);
        } else if ("DR_end" in dateMetadata && useDR) {
            // this is to allow a blank DR_end to mean "unknown"
            if (dateMetadata.DR_end) status.endDate = this.normalizeDate(dateMetadata.DR_end, true);
        } else if (dateMetadata.DR && useDR && pageType == "event") {
            // Only treat a lone DR as an end date for event-type pages.
            // For people/places/groups, a single DR should not imply the page has ended.
            status.endDate = this.normalizeDate(dateMetadata.DR, true);
        }

        this.setPageDateProperties(status, targetDate)

        return status;
    }


    getTargetDateForPage(metadata) {
        let dateMetadata = this.#getPageDateSource(metadata)

        if (customJS.state.overrideDate) {
            return this.normalizeDate(customJS.state.overrideDate, false);
        }

        if (dateMetadata && dateMetadata.pageTargetDate) {
            return this.normalizeDate(dateMetadata.pageTargetDate, false);
        }

        if (typeof window.TaelgarverseCalendar?.getCurrentDate === "function") {
            try {
                const currentDate = window.TaelgarverseCalendar.getCurrentDate();
                if (currentDate) return this.normalizeDate(currentDate, false);
            } catch (e) {
                // The new calendar may still be loading; use the existing calendars below.
            }
        }

        if (window.FantasyCalendarAPI == undefined || window.FantasyCalendarAPI.getCalendars().length == 0) {
            const calendarAPI = Calendarium.getAPI("Taelgar");
            const currentDate = calendarAPI.getCurrentDate(); // this is an object { year: number, month: number, day: number }
            return this.normalizeDate( {year: currentDate.year, month: currentDate.month, day: currentDate.day}, false);
        }

        return this.normalizeDate(window.FantasyCalendarAPI.getCalendars()[0].current, false);
    }

    // DR counts from the 291st day of the 4132nd year in the Dwarven count
    // The 4132nd year of the dwarven calendar started on March 17th the year before Drankor was founded
    // March 17 - Jan 1 is 290 days. Easier to not include DR 1/1/1 in the count so we don't have to correct later
    // So DR 1/1/1 = (4132*365) + 291 but we want DROneDays to be the day before 1/1/1

    DROneDays = (4132 * 365) + 290

    #getDayInMonth(month) {
        switch (month) {
            case 1: return 31
            case 2: return 28
            case 3: return 31
            case 4: return 30
            case 5: return 31
            case 6: return 30
            case 7: return 31
            case 8: return 31
            case 9: return 30
            case 10: return 31
            case 11: return 30
            case 12: return 31
        }
    }

    #getDaysSinceCreation(year, month, day) {
        // this assumes DR for now
        // this is the day before Jan 1, 1 DR
        let days = this.DROneDays

        // DR 1 is included in drOneDays, so we don't want to add anything for it
        days += ((year - 1) * 365) + day

        if (month > 1) days += this.#getDayInMonth(1)
        if (month > 2) days += this.#getDayInMonth(2)
        if (month > 3) days += this.#getDayInMonth(3)
        if (month > 4) days += this.#getDayInMonth(4)
        if (month > 5) days += this.#getDayInMonth(5)
        if (month > 6) days += this.#getDayInMonth(6)
        if (month > 7) days += this.#getDayInMonth(7)
        if (month > 8) days += this.#getDayInMonth(8)
        if (month > 9) days += this.#getDayInMonth(9)
        if (month > 10) days += this.#getDayInMonth(10)
        if (month > 11) days += this.#getDayInMonth(11)

        return days
    }

    #getDisplayForDaysSinceCreation(daysSinceCreation, dateFormat) {

         let convertedDays = 0

        if (dateFormat == "DR") {
            convertedDays = daysSinceCreation - this.DROneDays
        } else if (dateFormat == "CY") {
            convertedDays = daysSinceCreation
        }

        let year = Math.ceil(convertedDays / 365)
        let day = 0
        let month = 0
        let remaining = convertedDays - ((year - 1) * 365)

        // DR calculation //

        if (dateFormat == "DR") {
            for (let mCount = 1; mCount <= 12; mCount++) {
                let daysInThisMonth = this.#getDayInMonth(mCount)
                if (remaining <= daysInThisMonth) {
                    day = remaining
                    month = mCount
                    break
                }

                remaining -= daysInThisMonth
            }
          
            let dayString = day + "th"
            if (day % 100 < 11 || day % 100 > 13) {
                if (day % 10 == 1) dayString = day + "st"
                else if (day % 10 == 2) dayString = day + "nd"
                else if (day % 10 == 3) dayString = day + "rd"
            }

            return this.#getNameForMonth(month) + " " + dayString + ", " + year
        }


        // CY calculation //

        if (dateFormat == "CY") {
        
            // each block of 73 days is 2 months (35 days each) plus 3 intercalary days

            let block = Math.ceil(remaining/73)
            let remainingInBlock = remaining - ((block - 1) * 73)
            // month is block-1 * 2 + Math.ceil(remainingInBlock/35)    				
            let intercalDays = remainingInBlock > 70 ? remainingInBlock - 70 : 0            
            remainingInBlock = remainingInBlock - intercalDays
            let blockPart = Math.ceil(remainingInBlock/35)            
            month = ((block - 1) * 2) + blockPart
            let extraDays = remainingInBlock - ((blockPart-1) * 35)
            let dayString = extraDays.toString().padStart(2,"0")
            if (intercalDays) {
                dayString = extraDays.toString().padStart(2,"0") + "." + intercalDays.toString()
            }
            return "CY " + year.toString() + "-" + month.toString().padStart(2,"0") + "-" + dayString 
        }

    }

    normalizeDate(inputDate, isEnd) {

        if (inputDate == undefined) return undefined;
        if (inputDate == "") return undefined;

        let isString = typeof inputDate === 'string' || inputDate instanceof String

        if (!isString && inputDate.isNormalizedDate) return inputDate

        let year = 0, month = 0, days = 0
        let isHiddenDate = false
        let display = undefined

        if (isString) {
            // this is a string which we expect is either yyyy-mm-dd or yyyy-mm but something is wrong, most likely the actual year is not 4 digits
            let splitString = inputDate.split("-")
            if (splitString.length == 3) {
                year = parseInt(splitString[0])
                month = parseInt(splitString[1])
                days = parseInt(splitString[2])
            }
            else if (splitString.length == 2) {
                year = parseInt(splitString[0])
                month = parseInt(splitString[1])
                days = isEnd ? 1 : this.#getDayInMonth(month)
                display = this.#getNameForMonth(month) + " " + splitString[0];

            } else if (splitString.length == 1) {

                year = parseInt(splitString[0])
                month = isEnd ? 1 : 12
                days = isEnd ? 1 : 31
                display = "DR " + inputDate
                isHiddenDate = year == 1 || year == 9999

            } else {
                console.log("Unexpected incoming string: " + inputDate)
                return undefined
            }
        } else {

            switch (typeof (inputDate)) {
                case "number": {
                    year = inputDate
                    if (isEnd) {
                        month = 12
                        days = 31
                    } else {
                        month = 1
                        days = 1
                    }
                    display = "DR " + inputDate
                    isHiddenDate = year == 1 || year == 9999
                    break
                }
                case "object": {
                    if (inputDate.year == undefined) {
                        return undefined;
                    }

                    if (inputDate.isLuxonDateTime) {
                        year = inputDate.year
                        month = inputDate.month ?? (isEnd ? 12 : 1)
                        days = inputDate.day ?? (isEnd ? this.#getDayInMonth(month) : 1)
                    } else {
                        // fantasy calendar, zero-counts months, add one
                        year = inputDate.year
                        month = (inputDate.month + 1) ?? (isEnd ? 12 : 1)
                        days= inputDate.day ?? (isEnd ? this.#getDayInMonth(month) : 1)
                    }
                }
            }
        }

        if (year === 0) return undefined

        let daysSinceCreate = this.#getDaysSinceCreation(year, month, days)

        return { display: display ?? this.#getDisplayForDaysSinceCreation(daysSinceCreate, "DR"), sort: daysSinceCreate, year: year, days: daysSinceCreate, isNormalizedDate: true, isHiddenDate: isHiddenDate };        
    }

}
