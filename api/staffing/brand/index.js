const { resolveToken } = require('../../../shared/token-resolver')
const { createClient } = require('@supabase/supabase-js')

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const clientToken = url.searchParams.get('client')
  const orgId = await resolveToken(clientToken || null)

  if (!orgId) {
    return res.status(200).json({ company_name: 'Voxaris', logo_url: null, primary_color: '#ff6363' })
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { data: org } = await supabase
      .from('organizations')
      .select('name, company_name, logo_url, primary_color')
      .eq('id', orgId)
      .single()
    res.status(200).json({
      company_name: org?.company_name || org?.name || 'Voxaris',
      logo_url: org?.logo_url || null,
      primary_color: org?.primary_color || '#ff6363',
    })
  } catch {
    res.status(200).json({ company_name: 'Voxaris', logo_url: null, primary_color: '#ff6363' })
  }
}
