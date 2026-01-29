# Lead Type → Service Plan Filtering Implementation

## What Was Implemented

A graceful, sequential conversation flow where:
1. **Lead types** (user intent) guide to **relevant service plans**
2. Each service plan has **5 conversation questions**
3. **At least 2 service options** shown after every lead type (natural choice)
4. **Full UI support** for mapping lead types to service plans

---

## Changes Made

### 1. Backend (Integration Model)

**File:** `src/models/Integration.js`

Added `relevantServicePlans` array to each lead type:

```javascript
leadTypeMessages: [{
  id: Number,
  value: String,
  text: String,
  isActive: Boolean,
  order: Number,
  relevantServicePlans: [String]  // ← NEW: service plan names to show
}]
```

### 2. Backend (API Response)

**File:** `src/routes/user.js`

Modified `getLeadTypesFromIntegration()` to include `relevantServicePlans` in API response:

```javascript
return active.map(m => ({
  id: m.id,
  value: m.value || '',
  text: m.text || '',
  ...(Array.isArray(m.relevantServicePlans) && m.relevantServicePlans.length > 0 && 
      { relevantServicePlans: m.relevantServicePlans })
}));
```

### 3. AI Context Service

**File:** `Assistly-AI/app/services/context_service.py`

Preserves `relevantServicePlans` when building context:

```python
entry: Dict[str, Any] = {"id": item.get("id") or idx, "value": value, "text": text}
if isinstance(item.get("relevantServicePlans"), list) and item["relevantServicePlans"]:
    entry["relevantServicePlans"] = [str(s).strip() for s in item["relevantServicePlans"] if s]
lead_types.append(entry)
```

### 4. AI Response Generator

**File:** `Assistly-AI/app/services/response_generator.py`

Added filtering logic:

```python
@staticmethod
def _filter_services_by_lead_type(treatment_plans, lead_types, collected_lead_type):
    """Filter service plans by lead type's relevantServicePlans"""
    # Returns filtered list or None (show all)
```

Applied in:
- `_generate_service_selection_response()` - filters services shown in buttons
- `SERVICE_SELECTION` state - filters services that can be matched
- `_generate_data_collected_with_question_response()` - filters when answering questions

### 5. Frontend Model

**File:** `src/models/IntegrationSettings.ts`

```typescript
export interface LeadTypeMessage {
  id: number;
  value: string;
  text: string;
  isActive: boolean;
  order: number;
  relevantServicePlans?: string[];  // ← NEW
}
```

### 6. Frontend UI (Integration Page)

**File:** `src/app/integration/page.tsx`

Added:
- **Fetch service plans** on page load
- **Multi-select UI** for each lead type showing available service plans
- **Visual indicators** (selected = blue, unselected = gray)
- **"No filter" message** when no plans selected (shows all services)

---

## How to Use

### 1. Run Setup Script (Biryani Waala)

```bash
cd D:\Assistly\Assistly-Backend
node src/scripts/setupBiryaniWaalaFlow.js
```

This creates:
- 5 lead types with service mappings
- 5 service plans
- 5 conversation flows (5 questions each)
- Proper linking

### 2. Access UI (Any App)

1. Go to **Dashboard** → **Integration** page
2. Scroll to **"Lead Type Messages"** section
3. For each lead type, you'll see:
   - Text input (the lead type message)
   - **Service plan selector** (click to select/unselect)
   - If no plans selected → shows all services
   - If plans selected → shows only those services
4. Save changes

### 3. Testing the Flow

After setup, test in widget:

```
1. User sees greeting + 5 lead type buttons
2. User clicks "I need catering services for an event"
3. Bot shows ONLY: [Catering package] [Allergy-free & dietary options]  ← 2 relevant services
4. User picks "Catering package"
5. Bot asks 5 questions:
   - Event type?
   - Event date?
   - Guest count?
   - Menu preferences?
   - Dietary requirements?
6. Then: name → email → phone → lead created
```

---

## Biryani Waala Configuration

### Lead Type → Service Mapping

| Lead Type | Shows (2-4 services) |
|-----------|---------------------|
| "I want to place an order" | Delivery, Pickup, Dine-in |
| "I need catering for an event" | Catering, Allergy options |
| "I would like a dining reservation" | Dine-in, Allergy options |
| "I want to see your menu" | Delivery, Pickup, Dine-in, Catering |
| "I have allergies" | Allergy options, Delivery, Pickup |

### Service Plans (All Have 5 Questions)

1. **Dine-in experience** - Date, Time, Party size, Occasion, Dietary needs
2. **Delivery service** - Postcode, Address, Order, Time, Instructions
3. **Pickup service** - Items, Size, Time, Extras, Requests
4. **Catering package** - Event type, Date, Guests, Menu, Dietary
5. **Allergy-free & dietary** - Allergy type, Severity, Preference, Dishes, Concerns

---

## Benefits

✅ **Sequential flow** - lead type naturally leads to relevant services  
✅ **Reduced confusion** - users don't see irrelevant options  
✅ **Faster conversion** - fewer clicks to the right service  
✅ **Comprehensive leads** - 5 questions capture detailed information  
✅ **Easy management** - visual UI for mapping in dashboard  
✅ **Flexible** - can enable/disable filtering per lead type  

---

## Notes

- If `relevantServicePlans` is **empty or missing** → shows **all services** (no filtering)
- If `relevantServicePlans` has **values** → shows **only those services**
- Filtering applies to both **button display** and **service matching** (users can't bypass)
- Cache expires in 5 minutes, or restart backend to clear immediately
